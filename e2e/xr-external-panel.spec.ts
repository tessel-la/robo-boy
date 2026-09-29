import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installRosMock, getPublishedRosMessages } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, saveXrPanelPreview } from './helpers/xrEmulator';

// Integration against the unmodified external artifact; no Microduck code belongs in the host.
const panelDir = process.env.MICRODUCK_PANEL_DIR ?? resolve('../robo-boy-microduck-control-panel');

async function aim(page: Page, selector: string) {
  const uv = await page
    .frameLocator('iframe[title="Microduck Control"]')
    .locator(selector)
    .evaluate(el => {
      const r = el.getBoundingClientRect(),
        root = document.getElementById('panel-root')!;
      return { x: (r.left + r.width / 2) / root.clientWidth, y: 1 - (r.top + r.height / 2) / root.clientHeight };
    });
  await page.evaluate(async uv => {
    const path = '/node_modules/.vite/deps/three.js';
    const THREE = await import(/* @vite-ignore */ path);
    const panel = window.__xrScene.uiGroup.children.find(o => o.userData.placementId === 'xr-duck')!;
    const mesh = panel.getObjectByName('external-panel-surface')!;
    const point = mesh.localToWorld(new THREE.Vector3(uv.x - 0.5, uv.y - 0.5, 0));
    const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
    const origin = point.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(rotation));
    const hand = window.__xrDevice.controllers.right!;
    hand.position.set(origin.x, origin.y, origin.z);
    hand.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }, uv);
  await page.waitForTimeout(100);
}
const trigger = (page: Page, value: number) =>
  page.evaluate(value => window.__xrDevice.controllers.right!.updateButtonValue('trigger', value), value);
const lastVelocity = async (page: Page) =>
  (await getPublishedRosMessages(page, '/cmd_vel')).at(-1) as { linear: { x: number } } | undefined;

for (const mode of ['VR', 'AR'] as const) {
  test(`Microduck in ${mode} balances drive holds and action clicks`, async ({ page }) => {
    test.skip(!existsSync(resolve(panelDir, 'dist/index.js')), 'Set MICRODUCK_PANEL_DIR to the built Microduck panel');
    test.setTimeout(60000);
    const manifest = JSON.parse(readFileSync(resolve(panelDir, 'roboboy.panel.json'), 'utf8'));
    manifest.entryPoint = './microduck/1.0.0/index.js';
    await page.route('**/panels/installed.json', route =>
      route.fulfill({ json: { schemaVersion: 1, panels: [manifest] } })
    );
    await page.route('**/panels/microduck/1.0.0/index.js', route =>
      route.fulfill({ contentType: 'text/javascript', body: readFileSync(resolve(panelDir, 'dist/index.js')) })
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page, {
      serviceCalls: {
        '/locomotion/mouth': [{ values: { success: true } }],
        '/locomotion/jump': [{ values: { success: true } }],
      },
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-duck', type: 'la.tessel.roboboy.microduck-control', title: 'Microduck Control' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-duck']));
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    const panel = page.frameLocator('iframe[title="Microduck Control"]');
    await expect(panel.getByRole('button', { name: 'Drive forward', exact: true })).toBeEnabled();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.__xrScene.uiGroup.children
                .find(o => o.userData.placementId === 'xr-duck')
                ?.getObjectByName('external-panel-surface')?.visible
          ),
        { timeout: 15000 }
      )
      .toBe(true);
    await saveXrPanelPreview(page, 'xr-duck', `/tmp/robo-boy-xr-microduck-${mode.toLowerCase()}.png`);
    await aim(page, '[data-drive="forward"]');
    await trigger(page, 1);
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBeGreaterThan(0);
    await page.waitForTimeout(900); // Holds outlive the sandbox's dead-man timer with live XR input.
    expect((await lastVelocity(page))?.linear.x).toBeGreaterThan(0);
    await trigger(page, 0);
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBe(0);
    await aim(page, '[data-motion="walk"]');
    await trigger(page, 1);
    await page.waitForTimeout(100);
    await trigger(page, 0);
    await expect.poll(() => getPublishedRosMessages(page, '/locomotion/policy_cmd')).toContainEqual({ data: 'walk' });
    await aim(page, '[data-mouth="open"]');
    await trigger(page, 1);
    await page.waitForTimeout(100);
    await trigger(page, 0);
    await expect(panel.locator('[data-role="feedback"]')).toHaveText('Mouth opening.');
    await aim(page, '[data-action="jump"]');
    await trigger(page, 1);
    await page.waitForTimeout(100);
    await trigger(page, 0);
    await expect(panel.locator('[data-role="feedback"]')).toHaveText('Jump requested.');
    await aim(page, '[data-drive="forward"]');
    await trigger(page, 1);
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBeGreaterThan(0);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 1));
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBe(0);
    await trigger(page, 0);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('squeeze', 0));
    await aim(page, '[data-drive="forward"]');
    await trigger(page, 1);
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBeGreaterThan(0);
    await page.evaluate(() => window.__xrSession.end());
    await expect.poll(async () => (await lastVelocity(page))?.linear.x).toBe(0);
    await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
  });
}
