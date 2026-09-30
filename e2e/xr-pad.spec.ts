import { expect, test, type Page } from '@playwright/test';
import { installRosMock, getPublishedRosMessages } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

async function aim(page: Page, selector: string, x = 0.5, y = 0.5, hand: 'left' | 'right' = 'right') {
  const uv = await page.locator(selector).evaluate(
    (el, { x, y }) => {
      const r = el.getBoundingClientRect(),
        root = el.closest('.custom-gamepad-layout')!.getBoundingClientRect();
      const aspect = root.width / root.height,
        surfaceAspect = 1200 / 840;
      const w = Math.min(1, aspect / surfaceAspect),
        h = Math.min(1, surfaceAspect / aspect);
      return {
        x: (1 - w) / 2 + ((r.left + r.width * x - root.left) / root.width) * w,
        y: 1 - ((1 - h) / 2 + ((r.top + r.height * y - root.top) / root.height) * h),
      };
    },
    { x, y }
  );
  await page.evaluate(
    async ({ uv, hand }) => {
      const path = '/node_modules/.vite/deps/three.js';
      const THREE = await import(/* @vite-ignore */ path);
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      const mesh = panel.getObjectByName('xr-pad-surface')!;
      const point = mesh.localToWorld(new THREE.Vector3((uv.x - 0.5) * 0.86, (uv.y - 0.5) * 0.6, 0));
      const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
      const origin = point.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(rotation));
      const controller = window.__xrDevice.controllers[hand]!;
      controller.position.set(origin.x, origin.y, origin.z);
      controller.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
    { uv, hand }
  );
  await page.waitForTimeout(100);
}
const trigger = (page: Page, value: number, hand: 'left' | 'right' = 'right') =>
  page.evaluate(({ value, hand }) => window.__xrDevice.controllers[hand]!.updateButtonValue('trigger', value), {
    value,
    hand,
  });
const last = async (page: Page, topic: string) => (await getPublishedRosMessages(page, topic)).at(-1);

for (const mode of ['VR', 'AR'] as const) {
  test(`Pad in ${mode} shares commands and balances holds, drags and cancellation`, async ({ page }) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      const components = [
        {
          id: 'stick',
          type: 'joystick',
          position: { x: 0, y: 0, width: 2, height: 2 },
          label: 'Drive',
          action: { topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist' },
          config: { axes: ['linear.x', 'angular.z'] },
        },
        {
          id: 'button',
          type: 'button',
          position: { x: 2, y: 0, width: 1, height: 1 },
          label: 'Hold',
          action: { topic: '/hold', messageType: 'std_msgs/Bool' },
        },
        {
          id: 'toggle',
          type: 'toggle',
          position: { x: 3, y: 0, width: 1, height: 1 },
          label: 'Enable',
          action: { topic: '/enabled', messageType: 'std_msgs/msg/Bool' },
        },
        {
          id: 'dpad',
          type: 'dpad',
          position: { x: 2, y: 1, width: 1, height: 1 },
          action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy' },
        },
        {
          id: 'slider',
          type: 'slider',
          position: { x: 3, y: 1, width: 1, height: 1 },
          label: 'Speed',
          action: { topic: '/speed', messageType: 'std_msgs/msg/Float64' },
          config: { min: 0, max: 10, step: 1 },
        },
        {
          id: 'setpoint',
          type: 'setpoint',
          position: { x: 0, y: 2, width: 4, height: 1 },
          label: 'Target',
          action: { topic: '/target', messageType: 'std_msgs/msg/Float64' },
          config: { min: 0, max: 10, step: 1 },
        },
      ];
      const layout = {
        id: 'xr-test',
        name: 'XR test',
        gridSize: { width: 4, height: 3 },
        cellSize: 100,
        components,
        rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
        metadata: { created: '', modified: '', version: '1' },
      };
      localStorage.setItem(
        'robo-boy-custom-gamepads',
        JSON.stringify({
          version: '1.0.0',
          customLayouts: [{ id: layout.id, name: layout.name, description: '', isDefault: false, layout }],
          lastModified: '',
        })
      );
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-pad', type: 'pad', title: 'Pad controls', layoutId: layout.id }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-pad']));
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('.joystick-component')).toBeVisible();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await page.waitForTimeout(1500);
    await saveXrPanelPreview(page, 'xr-pad', `/tmp/robo-boy-xr-pad-${mode.toLowerCase()}.png`);
    await aim(page, '.button-component');
    await trigger(page, 1);
    await expect.poll(() => last(page, '/hold')).toEqual({ data: true });
    await trigger(page, 0);
    await expect.poll(() => last(page, '/hold')).toEqual({ data: false });
    await aim(page, '.toggle-switch');
    await trigger(page, 1);
    await trigger(page, 0);
    await expect.poll(() => last(page, '/enabled')).toEqual({ data: true });
    await aim(page, '.joystick-component', 0.75, 0.5);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.4);
    await aim(page, '.joystick-component', 0.25, 0.5);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeLessThan(-0.4);
    await page.waitForTimeout(350);
    expect(((await last(page, '/cmd_vel')) as any).linear.x).toBeLessThan(-0.4);
    // Second hand cannot take ownership or stop the first hand's joystick.
    await aim(page, '.joystick-component', 0.8, 0.5, 'left');
    await trigger(page, 1, 'left');
    await trigger(page, 0, 'left');
    expect(((await last(page, '/cmd_vel')) as any).linear.x).toBeLessThan(-0.4);
    await trigger(page, 0);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    await aim(page, '.dpad-component button:first-child', 0.5, 0.5);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/joy')) as any)?.buttons[0]).toBe(1);
    await trigger(page, 0);
    await expect.poll(async () => ((await last(page, '/joy')) as any)?.buttons[0]).toBe(0);
    await aim(page, '.slider-component input', 0.2);
    await trigger(page, 1);
    await expect.poll(() => last(page, '/speed')).toEqual({ data: 2 });
    await aim(page, '.slider-component input', 0.8);
    await expect.poll(() => last(page, '/speed')).toEqual({ data: 8 });
    await trigger(page, 0);
    await aim(page, '[aria-label="Increase Target"]');
    await trigger(page, 1);
    await trigger(page, 0);
    await aim(page, '[aria-label="Send Target"]');
    await trigger(page, 1);
    await trigger(page, 0);
    await expect.poll(() => last(page, '/target')).toEqual({ data: 1 });
    await aim(page, '.joystick-component', 0.8);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.5);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 1));
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    await trigger(page, 0);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 0));
    await aim(page, '.joystick-component', 0.8);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.5);
    // Leaving the original control cancels, and returning cannot restart a held command.
    await aim(page, '.button-component');
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    await aim(page, '.joystick-component', 0.8);
    await page.waitForTimeout(200);
    expect(((await last(page, '/cmd_vel')) as any).linear.x).toBe(0);
    await trigger(page, 0);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.5);
    await page.evaluate(() => window.__xrSession.end());
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    // Selecting a different layout inside XR releases commands before replacing controls.
    await trigger(page, 0);
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await page.waitForTimeout(1000);
    await aim(page, '.joystick-component', 0.8);
    await trigger(page, 1);
    await expect.poll(async () => (await last(page, '/cmd_vel') as any)?.linear.x).toBeGreaterThan(0.5);
    await pressXrControl(page, 'xr-pad', 'pad-layouts');
    await pressXrControl(page, 'xr-pad', 'row-0');
    await expect.poll(async () => (await last(page, '/cmd_vel') as any)?.linear.x).toBe(0);
    await expect(page.getByRole('button', { name: 'Hold', exact: true })).toHaveCount(0);
    await trigger(page, 0);
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });
}
