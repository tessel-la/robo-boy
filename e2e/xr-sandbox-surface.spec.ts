import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl } from './helpers/xrEmulator';

// Always runs in CI, including when no external panel repositories are checked out.
const source = `export default {
  apiVersion: '2.0.0', id: 'test.xr.surface', activate() {
    return { mount(root) { root.innerHTML = '<div style="height:100%;overflow:auto"><div style="height:900px;background:#123456;color:white;padding:20px"><button style="transform:translateX(2px);box-shadow:0 0 2px color-mix(in srgb, red 50%, blue)">Snapshot fixture</button></div></div>'; }, unmount() {} };
  }
};`;
test('opaque sandbox captures, scrolls, restores styles and returns to desktop dimensions', async ({ page }) => {
  const manifest = {
    schemaVersion: 1,
    id: 'test.xr.surface',
    name: 'Surface fixture',
    description: 'XR capture regression',
    version: '1.0.0',
    entryPoint: './fixture/1.0.0/index.js',
    integrity: 'sha256-' + createHash('sha256').update(source).digest('base64'),
    compatibility: { panelApi: '^2.0.0', roboboy: '*' },
    capabilities: [],
    author: { name: 'Test' },
    repository: 'https://example.com/panel',
  };
  await page.route('**/panels/installed.json', route =>
    route.fulfill({ json: { schemaVersion: 1, panels: [manifest] } })
  );
  await page.route('**/panels/fixture/1.0.0/index.js', route =>
    route.fulfill({ contentType: 'text/javascript', body: source })
  );
  await installXrEmulator(page);
  await installRosMock(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([{ id: 'surface-fixture', type: 'test.xr.surface', title: 'Surface fixture' }])
    );
    localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['surface-fixture']));
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  const iframe = page.locator('iframe[title="Surface fixture"]');
  const button = page.frameLocator('iframe[title="Surface fixture"]').getByRole('button');
  await expect(button).toBeVisible();
  const style = await button.getAttribute('style');
  const width = await iframe.evaluate(el => el.clientWidth);
  await observeXrScene(page);
  await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mesh = window.__xrScene.uiGroup.children
          .find(o => o.userData.placementId === 'surface-fixture')
          ?.getObjectByName('external-panel-surface');
        return (
          mesh?.visible &&
          (mesh as import('three').Mesh<import('three').BufferGeometry, import('three').MeshBasicMaterial>).material.map
            ?.image.width
        );
      })
    )
    .toBe(720);
  await expect(button).toHaveAttribute('style', style!);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-downloads allow-forms');
  await pressXrControl(page, 'surface-fixture', 'scroll-down');
  await expect.poll(() => button.evaluate(el => el.parentElement!.parentElement!.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => window.__xrSession.end());
  await expect.poll(() => iframe.evaluate(el => el.clientWidth)).toBe(width);
});
