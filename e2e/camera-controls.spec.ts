import sharp from 'sharp';
import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

for (const [width, theme] of [
  [320, 'dark'],
  [390, 'light'],
  [1280, 'solarized'],
] as const) {
  test(`camera toolbar stays usable at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    const topic = '/robot/front/camera/color/image_raw';
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#20394a' } })
      .jpeg()
      .toBuffer();
    await page.setViewportSize({ width, height: 844 });
    await installRosMock(page, { topics: [{ name: topic, type: 'sensor_msgs/msg/Image' }] });
    await page.route('**/video_stream/**', route => route.fulfill({ contentType: 'image/jpeg', body: jpeg }));
    await page.addInitScript(
      ({ topic, theme }) => {
        localStorage.setItem('appTheme', theme);
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
      camera.getByLabel('Camera topic', { exact: true }),
      camera.getByLabel('Stream quality', { exact: true }),
      camera.getByRole('button', { name: 'Refresh camera topics and stream' }),
    ];
    const panel = (await camera.boundingBox())!;
    for (const control of controls) {
      await expect(control).toBeEnabled();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(panel.x);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width);
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
    await controls[1].selectOption('original');
    await controls[2].click();
    await expect(controls[2]).toBeEnabled();
    await expect(controls[1]).toHaveValue('original');
    await expect(camera.locator('img')).toBeVisible();
    await expect.poll(() => camera.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(640);
    await expect(page.locator('.workspace-opening')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('camera-controls.png') });
  });
}
