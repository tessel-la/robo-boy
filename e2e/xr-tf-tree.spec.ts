import { expect, test, type Page } from '@playwright/test';
import { getActiveRosSubscriptionCount, installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

const transform = (parent: string, child: string, x = 1) => ({
  header: { frame_id: parent },
  child_frame_id: child,
  transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
});
const hasFrame = (page: Page, frame: string) =>
  page.evaluate(frame => {
    const panel = window.__xrScene.uiGroup.children.find(object => object.userData.placementId === 'xr-tf');
    let found = false;
    panel?.traverse(object => {
      if (object.userData.xrSurface?.getItem(`frame:${frame}`)) found = true;
    });
    return found;
  }, frame);

for (const mode of ['VR', 'AR'] as const) {
  test(`native TF tree in ${mode} shares live TF and filters and restores desktop`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-tf', type: 'tfTree', title: 'TF tree' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-tf']));
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('tf-tree-panel')).toBeVisible();
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    await page.evaluate(
      transforms => {
        window.__publishRosTopic?.('/tf', { transforms: [transforms[0]] });
        window.__publishRosTopic?.('/tf_static', { transforms: [transforms[1]] });
      },
      [transform('map', 'base'), transform('base', 'camera', 2)]
    );
    await expect(page.locator('.react-flow__node').filter({ hasText: 'camera' })).toHaveCount(1);
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => hasFrame(page, 'camera')).toBe(true);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf_static')).toBe(1);
    // TF arriving in XR updates its graph while the invisible desktop graph is frozen.
    await page.evaluate(t => window.__publishRosTopic?.('/tf', { transforms: [t] }), transform('base', 'tool'));
    await expect.poll(() => hasFrame(page, 'tool')).toBe(true);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'tool' })).toHaveCount(0);
    await pressXrControl(page, 'xr-tf', 'settings');
    await pressXrControl(page, 'xr-tf', 'row-0');
    await expect.poll(() => hasFrame(page, 'camera')).toBe(false);
    await pressXrControl(page, 'xr-tf', 'row-0');
    await expect.poll(() => hasFrame(page, 'camera')).toBe(true);
    await pressXrControl(page, 'xr-tf', 'frame:base');
    await pressXrControl(page, 'xr-tf', 'row-4'); // transform values
    await saveXrPanelPreview(page, 'xr-tf', `/tmp/robo-boy-xr-tf-tree-${mode.toLowerCase()}.png`);
    await page.evaluate(() => window.__xrSession.end());
    await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'tool' })).toHaveCount(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf_static')).toBe(1);
    expect(errors).toEqual([]);
  });
}
