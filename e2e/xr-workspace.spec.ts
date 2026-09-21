import { expect, test } from '@playwright/test';
import { installRosMock, getActiveRosSubscriptionCount } from './helpers/rosMock';
import { installXrEmulator, observeXrScene } from './helpers/xrEmulator';

for (const mode of ['VR', 'AR'] as const) {
  test(`emulates ${mode}: renders real geometry, carries panels and restores the workspace`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installXrEmulator(page);
    await installRosMock(page, { topics: [{ name: '/robot_description', type: 'std_msgs/msg/String' }] });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Desktop workspace')).toBeVisible();
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'TF tree', exact: true }).click();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__xrScene.uiGroup.children.length)).toBe(1);
    await page.evaluate(() => {
      window.__publishRosTopic?.('/robot_description', { data: '<robot name="xr-test"><link name="base_link"><visual><geometry><box size="0.4 0.3 0.2"/></geometry></visual></link></robot>' });
      window.__publishRosTopic?.('/tf', { transforms: [{ header: { frame_id: 'odom' }, child_frame_id: 'base_link', transform: { translation: { x: 0.2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] });
    });
    await expect.poll(() => page.evaluate(() => {
      let meshes = 0;
      window.__xrScene.worldGroup.traverse(object => { if (object.type === 'Mesh') meshes++; });
      return meshes;
    })).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__xrScene.scene.background === null)).toBe(mode === 'AR');
    await expect.poll(() => page.evaluate(() => window.__xrScene.worldGroup.getObjectByName('base_link')?.position.x)).toBeCloseTo(0.2);
    await page.evaluate(() => window.__publishRosTopic?.('/tf', { transforms: [{ header: { frame_id: 'odom' }, child_frame_id: 'base_link', transform: { translation: { x: 0.6, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] }));
    await expect.poll(() => page.evaluate(() => window.__xrScene.worldGroup.getObjectByName('base_link')?.position.x)).toBeCloseTo(0.6);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf_static')).toBe(1);

    // A real emulated squeeze gesture moves the panel via WebXR -> Three -> input/grab managers.
    await page.evaluate(() => {
      const hand = window.__xrDevice.controllers.right!;
      hand.position.set(0, 1.4, -0.3);
      hand.quaternion.set(0, 0, 0, 1);
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => { window.__xrDevice.controllers.right!.position.x += 0.3; });
    await expect.poll(() => page.evaluate(() => window.__xrScene.uiGroup.children[0].position.x)).toBeCloseTo(0.3, 1);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 0));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrSession.end());
    await expect(page.getByRole('button', { name: /Enter XR Workspace/ })).toBeVisible();
    await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
    await expect(page.locator('.workspace-card')).toHaveCount(1);
    // Re-entry restores the placement and does not accumulate TF subscriptions.
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene.uiGroup.children[0]?.position.x)).toBeCloseTo(0.3, 1);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    await page.evaluate(() => window.__xrSession.end());
    await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('simulator: shares the live ROS robot configuration and restores 2D rendering', async ({ page }) => {
  test.skip(process.env.ROBOBOY_XR_SIMULATOR !== '1', 'Requires the running ROS simulator stack');
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installXrEmulator(page);
  // Observe traffic on the application's connection; never create another ROS connection.
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    (window as any).__simTfMessages = 0;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', event => {
          if (typeof event.data !== 'string') return;
          const message = JSON.parse(event.data);
          if (message.op === 'publish' && message.topic === '/tf') {
            (window as any).__simTfMessages++;
            (window as any).__simTf = message.msg.transforms;
          }
        });
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect', exact: true }).click();
  await expect(page.getByLabel('Desktop workspace')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const fixedFrame = process.env.ROBOBOY_XR_FIXED_FRAME ?? 'panda_link0';
  await expect(page.locator('#fixed-frame-select option', { hasText: fixedFrame })).toHaveCount(1);
  await page.getByLabel('Fixed Frame:').selectOption(fixedFrame);
  await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByRole('button', { name: /URDF/ }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await observeXrScene(page);
  await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
  await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    let meshes = 0;
    window.__xrScene.worldGroup.traverse(object => { if (object.type === 'Mesh') meshes++; });
    return meshes;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const tf = (window as any).__simTf?.find((transform: any) => transform.child_frame_id === 'panda_link1');
    const link = window.__xrScene.worldGroup.getObjectByName('panda_link1');
    if (!tf || !link) return false;
    return Math.abs(link.position.z - tf.transform.translation.z) < 0.001 &&
      Math.abs(link.quaternion.z - tf.transform.rotation.z) < 0.001;
  })).toBe(true);
  const before = await page.evaluate(() => (window as any).__simTfMessages as number);
  await expect.poll(() => page.evaluate(() => (window as any).__simTfMessages as number)).toBeGreaterThan(before + 5);
  await page.screenshot({ path: 'test-results/xr-simulator.png' });
  await page.evaluate(() => window.__xrSession.end());
  await expect(page.getByRole('button', { name: /Enter XR Workspace/ })).toBeVisible();
  await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
  await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
