import { expect, test, type Page } from '@playwright/test';
import { installRosMock, getPublishedRosMessages } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

async function aim(page: Page, selector: string, x = 0.5, y = 0.5, hand: 'left' | 'right' = 'right') {
  const hit = await page.locator(selector).evaluate(
    (el, { x, y }) => {
      const block = el.closest<HTMLElement>('[data-component-id]')!;
      const component = block.dataset.componentId!;
      if (el.closest('.dpad-component')) {
        const index = [...block.querySelectorAll('button')].indexOf(el as HTMLButtonElement);
        return { component, part: ['up', 'left', 'right', 'down'][index], x: 0.5, y: 0.5 };
      }
      if (el.closest('.pad-setpoint')) {
        const rect = el.getBoundingClientRect(),
          parent = block.getBoundingClientRect();
        return {
          component,
          part: '',
          x: (rect.left + rect.width * x - parent.left) / parent.width,
          y: (rect.top + rect.height * y - parent.top) / parent.height,
        };
      }
      return { component, part: '', x, y };
    },
    { x, y }
  );
  await page.evaluate(
    async ({ hit, hand }) => {
      const path = '/node_modules/.vite/deps/three.js';
      const THREE = await import(/* @vite-ignore */ path);
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      const mesh = panel.getObjectByName(`xr-pad-hit:${hit.component}${hit.part ? ':' + hit.part : ''}`)!;
      const size = (mesh as any).geometry.parameters;
      const point = mesh.localToWorld(new THREE.Vector3((hit.x - 0.5) * size.width, (0.5 - hit.y) * size.height, 0));
      const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
      const origin = point.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(rotation));
      const controller = window.__xrDevice.controllers[hand]!;
      controller.position.set(origin.x, origin.y, origin.z);
      controller.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
    { hit, hand }
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
        gridSize: { width: 4, height: 4 },
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
    const heldControl = await page.evaluate(async () => {
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      const path = '/src/features/theme/themeUtils.ts';
      const { applyThemeToDocument } = await import(/* @vite-ignore */ path);
      applyThemeToDocument('light', []);
      return panel.getObjectByName('xr-pad-control:button')!.uuid;
    });
    await expect.poll(() => page.evaluate(() => {
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      // Base materials repaint in place while the mounted desktop control still owns the hold.
      const block = panel.getObjectByName('xr-pad-control:button')!;
      const base = (block.children[0] as any).material;
      return { uuid: block.uuid, color: base.color.getHexString() };
    })).toEqual({ uuid: heldControl, color: 'ffffff' });
    expect(await last(page, '/hold')).toEqual({ data: true });
    await trigger(page, 0);
    await expect.poll(() => last(page, '/hold')).toEqual({ data: false });
    await page.evaluate(async () => {
      const path = '/src/features/theme/themeUtils.ts';
      const { applyThemeToDocument } = await import(/* @vite-ignore */ path);
      applyThemeToDocument('dark', []);
    });
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
    // The immersive designer owns a draft and disables commands before any object manipulation.
    await trigger(page, 0);
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await page.waitForTimeout(500);
    await aim(page, '.joystick-component', 0.8);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.5);
    await pressXrControl(page, 'xr-pad', 'pad-editor');
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    await trigger(page, 0);
    await expect(page.locator('.gamepad-component.editing')).toHaveCount(6);
    const before = await page.evaluate(() => {
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      return panel.getObjectByName('xr-pad-control:button')!.position.toArray();
    });
    await aim(page, '.button-component');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const hand = window.__xrDevice.controllers.right!;
      hand.position.x += 0.12;
      hand.position.y -= 0.39;
      hand.position.z += 0.08;
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 0));
    const moved = await page.evaluate(() => {
      const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
      return panel.getObjectByName('xr-pad-control:button')!.position.toArray();
    });
    expect(moved[0]).toBeCloseTo(before[0] + 0.13, 3);
    expect(moved[1]).toBeCloseTo(before[1] - 0.39, 3);
    expect(moved[2]).toBeCloseTo(0.025, 3);
    // A drop over the occupied original row is rejected, with a visible red destination.
    await aim(page, '.button-component');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__xrDevice.controllers.right!.position.y += 0.39;
    });
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => {
        const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
        const preview = panel.getObjectByName('xr-pad-grid-destination') as any;
        return { visible: preview.visible, error: `#${preview.material.color.getHexString()}` === getComputedStyle(document.documentElement).getPropertyValue('--error-color').trim() };
      })
    ).toEqual({ visible: true, error: true });
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 0));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
          return panel.getObjectByName('xr-pad-control:button')!.position.toArray();
        })
      )
      .toEqual(moved);
    // Releasing one of two grips still carries the object; the final release snaps it.
    await aim(page, '.button-component', 0.25);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 1));
    await aim(page, '.button-component', 0.75, 0.5, 'left');
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__xrDevice.controllers.left!.position.z += 0.08;
      window.__xrDevice.controllers.right!.position.z += 0.08;
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 0));
    await page.waitForTimeout(100);
    expect(
      await page.evaluate(() => {
        const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
        return panel.getObjectByName('xr-pad-control:button')!.position.z;
      })
    ).toBeCloseTo(0.105, 3);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 0));
    await expect
      .poll(() =>
        page.evaluate(() => {
          const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
          return panel.getObjectByName('xr-pad-control:button')!.position.z;
        })
      )
      .toBeCloseTo(0.025, 3);
    await aim(page, '.button-component');
    await trigger(page, 1);
    await trigger(page, 0);
    await pressXrControl(page, 'xr-pad', 'row-0'); // Label, in the selected object's settings.
    await pressXrControl(page, 'xr-pad', 'clear');
    for (const key of ['h', 'o', 'l', 'd', 'space', 'x', 'r'])
      await pressXrControl(page, 'xr-pad', key === 'space' ? 'space' : `key-${key}`);
    await pressXrControl(page, 'xr-pad', 'apply-input');
    await saveXrPanelPreview(page, 'xr-pad', `/tmp/robo-boy-xr-pad-designer-${mode.toLowerCase()}.png`);
    await pressXrControl(page, 'xr-pad', 'pad-save');
    await expect(page.locator('.gamepad-component.editing')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'hold xr', exact: true })).toHaveCount(1);
    const saved = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(key => key.startsWith('robo-boy-xr-pad-v1:xr-test'))!;
      const layout = JSON.parse(localStorage.getItem('robo-boy-custom-gamepads')!).customLayouts.find(
        (item: any) => item.id === 'xr-test'
      ).layout;
      return { poses: JSON.parse(localStorage.getItem(key)!), layout };
    });
    expect(saved.poses.button.position[0]).toBeCloseTo(moved[0], 3);
    expect(saved.layout.components.find((c: any) => c.id === 'button').position).toEqual({
      x: 2,
      y: 0,
      width: 1,
      height: 1,
    });
    // Cancelling a second edit restores the saved objects; desktop control handlers are available again.
    await pressXrControl(page, 'xr-pad', 'pad-editor');
    await aim(page, '.button-component');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__xrDevice.controllers.right!.position.x -= 0.13;
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('squeeze', 0));
    await pressXrControl(page, 'xr-pad', 'pad-cancel');
    expect(
      await page.evaluate(() => {
        const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-pad')!;
        return panel.getObjectByName('xr-pad-control:button')!.position.x;
      })
    ).toBeCloseTo(moved[0], 3);
    await page.evaluate(() => window.__xrSession.end());
    await page.getByRole('button', { name: 'hold xr', exact: true }).dispatchEvent('pointerdown');
    await expect.poll(() => last(page, '/hold')).toEqual({ data: true });
    await page.getByRole('button', { name: 'hold xr', exact: true }).dispatchEvent('pointerup');
    await expect.poll(() => last(page, '/hold')).toEqual({ data: false });
    // Selecting a different layout inside XR releases commands before replacing controls.
    await trigger(page, 0);
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await page.waitForTimeout(1000);
    await aim(page, '.joystick-component', 0.8);
    await trigger(page, 1);
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBeGreaterThan(0.5);
    await pressXrControl(page, 'xr-pad', 'pad-layouts');
    await pressXrControl(page, 'xr-pad', 'row-0');
    await expect.poll(async () => ((await last(page, '/cmd_vel')) as any)?.linear.x).toBe(0);
    await expect(page.getByRole('button', { name: 'hold xr', exact: true })).toHaveCount(0);
    await trigger(page, 0);
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });
}
