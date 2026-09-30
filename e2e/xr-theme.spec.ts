import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, saveXrPanelPreview } from './helpers/xrEmulator';

for (const mode of ['VR', 'AR'] as const) {
  test(`XR in ${mode} shares desktop theme and repaints existing panels`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      localStorage.setItem('appTheme', 'dark');
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'theme-camera', type: 'camera', title: 'Camera' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['theme-camera']));
      // Observe text actually painted on native canvases, without a production debug hook.
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        this.canvas.dataset.paintedFont = this.font;
        return fillText.apply(this, args);
      };
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'theme-camera'))
        )
      )
      .toBe(true);
    const original = await page.evaluate(() => {
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'theme-camera')!;
      return {
        uuid: panel.uuid,
        position: panel.position.toArray(),
        rotation: panel.quaternion.toArray(),
        scale: panel.scale.toArray(),
      };
    });
    for (const theme of ['dark', 'light', 'solarized', 'tessella-test']) {
      await page.evaluate(async theme => {
        const path = '/src/features/theme/themeUtils.ts';
        const { applyThemeToDocument } = await import(/* @vite-ignore */ path);
        applyThemeToDocument(theme, [
          {
            id: 'tessella-test',
            name: 'Tessella',
            fontFamily: "Georgia, 'Times New Roman', serif",
            colors: {
              primary: '#3e5fd8',
              secondary: '#ffa65c',
              background: '#fff6d5',
              text: '#121212',
              cardBg: '#fffbec',
            },
          },
        ]);
      }, theme);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const themePath = '/src/xr/ui/xrTheme.ts';
            const threePath = '/node_modules/.vite/deps/three.js';
            const { XR_THEME } = await import(/* @vite-ignore */ themePath);
            const THREE = await import(/* @vite-ignore */ threePath);
            const styles = getComputedStyle(document.documentElement);
            const card = styles.getPropertyValue('--card-bg').trim();
            const background = styles.getPropertyValue('--background-color').trim();
            const foreground = styles.getPropertyValue('--text-color').trim();
            const font = styles.getPropertyValue('--font-family-ui').trim();
            const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'theme-camera')!;
            let plateMatches = false,
              titleFontMatches = false;
            panel.traverse(object => {
              const material = (object as any).material;
              if (material?.isMeshBasicMaterial && !material.map && material.opacity > 0)
                plateMatches = material.color.equals(new THREE.Color(card));
              if (object.userData.xrSurface?.getItem('close'))
                titleFontMatches = material.map.image.dataset.paintedFont.includes(
                  font.split(',')[0].replaceAll("'", '')
                );
            });
            const image = (panel.getObjectByName('xr-camera-image') as any).material.map.image as HTMLCanvasElement;
            const pixel = image.getContext('2d')!.getImageData(5, 5, 1, 1).data;
            const expected = new THREE.Color(card).getHex();
            return {
              pointer: (window.__xrScene.scene.getObjectByName('xr-pointer-ray') as any).material.color.equals(
                new THREE.Color(foreground)
              ),
              tokens: XR_THEME.surface === card && XR_THEME.font === font,
              plate: plateMatches,
              text: titleFontMatches && image.dataset.paintedFont!.includes(font.split(',')[0].replaceAll("'", '')),
              placeholder:
                pixel[0] === expected >> 16 && pixel[1] === ((expected >> 8) & 255) && pixel[2] === (expected & 255),
              environment:
                window.__xrScene.mode === 'immersive-ar'
                  ? window.__xrScene.scene.background === null
                  : (window.__xrScene.scene.background as any).equals(new THREE.Color(background)),
            };
          })
        )
        .toEqual({ pointer: true, tokens: true, plate: true, text: true, placeholder: true, environment: true });
      const current = await page.evaluate(() => {
        const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'theme-camera')!;
        return {
          uuid: panel.uuid,
          position: panel.position.toArray(),
          rotation: panel.quaternion.toArray(),
          scale: panel.scale.toArray(),
        };
      });
      expect(current).toEqual(original);
      await saveXrPanelPreview(page, 'theme-camera', `/tmp/robo-boy-xr-theme-${mode.toLowerCase()}-${theme}.png`);
    }
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });
}
