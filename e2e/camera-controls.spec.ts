import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

for (const [width, theme, touch] of [
  [320, 'dark', false],
  [390, 'light', false],
  [1280, 'solarized', false],
  [320, 'dark', true],
  [390, 'custom-cobalt', false],
] as const) {
  test.describe(`${width}px ${theme}${touch ? ' touch' : ''}`, () => {
    test.use({ hasTouch: touch });
    test.skip(({ browserName }) => touch && browserName !== 'chromium', 'Firefox does not emulate touch input');
    test(`camera toolbar stays usable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const topic = '/robot/front/camera/color/image_raw';
      const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#20394a' } })
        .jpeg()
        .toBuffer();
      await page.setViewportSize({ width, height: 844 });
      await installRosMock(page, {
        topics: [
          { name: topic, type: 'sensor_msgs/msg/Image' },
          { name: '/robot/front/camera/color/camera_info', type: 'sensor_msgs/msg/CameraInfo' },
        ],
      });
      await page.route('**/webrtc/_discovery/paths', route => route.fulfill({ json: { items: [] } }));
      await page.route('**/video_stream/**', route => route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
      await page.addInitScript(
        ({ topic, theme }) => {
          localStorage.setItem('appTheme', theme);
          localStorage.setItem(
            'customThemes',
            JSON.stringify([
              {
                id: 'custom-cobalt',
                name: 'Cobalt test',
                fontFamily: "Georgia, 'Times New Roman', serif",
                colors: {
                  primary: '#ff9c70',
                  secondary: '#77c8ff',
                  background: '#112866',
                  text: '#f5efd9',
                  border: '#657cb7',
                  cardBg: '#19316a',
                  buttonText: '#14234a',
                },
              },
            ])
          );
          localStorage.setItem(
            'robo-boy-desktop-workspace-panels-v1',
            JSON.stringify([{ id: 'camera-controls', type: 'camera', title: 'Camera', cameraTopic: topic }])
          );
        },
        { topic, theme }
      );
      await page.goto('/');
      await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
      const camera = page.locator('.camera-view');
      await expect(camera.locator('img')).toBeVisible();
      const controls = [
        camera.getByRole('button', { name: 'Camera settings', exact: true }),
        camera.getByLabel('Camera topic', { exact: true }),
        camera.getByRole('button', { name: 'Refresh camera topics and stream' }),
      ];
      const panel = (await camera.boundingBox())!;
      const boxes = [];
      for (const control of controls) {
        await expect(control).toBeEnabled();
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(panel.x);
        expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
        expect(box.height).toBeGreaterThanOrEqual(touch ? 44 : 36);
        boxes.push(box);
      }
      // Floating controls stay on one row without covering each other or shrinking the video canvas.
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].y).toBe(boxes[0].y);
        expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
      }
      expect(boxes[2].width).toBe(boxes[2].height);
      const canvas = (await camera.locator('.camera-stream-container').boundingBox())!;
      expect(canvas.height).toBeGreaterThanOrEqual(panel.height - 2);
      await controls[0].click();
      const menu = camera.getByRole('dialog', { name: 'Camera settings', exact: true });
      await expect(menu).toBeVisible();
      if (theme === 'custom-cobalt')
        expect(await menu.evaluate(el => getComputedStyle(el).fontFamily)).toContain('Georgia');
      await camera.getByLabel('Stream quality', { exact: true }).selectOption('original');
      await camera.getByRole('button', { name: 'Close camera settings', exact: true }).click();
      await controls[2].click();
      await expect(controls[2]).toBeEnabled();
      await controls[0].click();
      await expect(camera.getByLabel('Stream quality', { exact: true })).toHaveValue('original');
      await camera.getByLabel('Camera image source').selectOption('webrtc');
      for (const control of await menu.locator('select, input').all()) {
        const box = (await control.boundingBox())!;
        const bounds = (await menu.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(await control.evaluate(el => getComputedStyle(el).fontFamily)).toBe(
          await menu.evaluate(el => getComputedStyle(el).fontFamily)
        );
      }
      await page.screenshot({ path: testInfo.outputPath('camera-settings.png') });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await controls[0].click();
      await camera.getByLabel('Camera image source').selectOption('stream');
      await camera.getByRole('button', { name: 'Close camera settings', exact: true }).click();
      await expect(camera.locator('img')).toBeVisible();
      await expect
        .poll(() => camera.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBe(640);
      await expect(page.locator('.workspace-opening')).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('camera-controls.png') });
      await page.getByLabel('Add workspace panel').first().click();
      await page.getByRole('button', { name: '3D panel', exact: true }).click();
      const viewer = page.locator('.visualization-panel');
      await viewer.getByRole('button', { name: 'Settings', exact: true }).click();
      await viewer.getByRole('tab', { name: /^Visualizations/ }).click();
      await viewer.getByRole('button', { name: 'Add visualization', exact: true }).click();
      await page.getByTitle(`Add Camera image (${topic})`, { exact: true }).click();
      await viewer.getByRole('tab', { name: /^Visualizations/ }).click();
      const details = viewer.locator('.visualization-options');
      await expect(details).not.toHaveAttribute('open');
      const summary = viewer.getByLabel(`Display settings for Camera image on ${topic}`, { exact: true });
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(details).toHaveAttribute('open');
      const settings = viewer.locator('.settings-popup');
      const settingsFont = await settings.evaluate(el => getComputedStyle(el).fontFamily);
      for (const control of await details.locator('select, input:not([type="checkbox"]):not([type="range"])').all()) {
        const box = (await control.boundingBox())!;
        const bounds = (await settings.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(await control.evaluate(el => getComputedStyle(el).fontFamily)).toBe(settingsFont);
      }
      const list = viewer.locator('.active-visualizations-list');
      expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await list.evaluate(el => {
        el.scrollTop = 0;
      });
      await page.screenshot({ path: testInfo.outputPath('visualization-settings.png') });
      await viewer.getByLabel(`Projection update rate for Camera image on ${topic}`).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('visualization-fields.png') });
      await summary.click();
      await expect(details).not.toHaveAttribute('open');
    });
  });
}
