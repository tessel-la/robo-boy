import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import { createPanelSandboxDocument } from '../src/panels/sandboxRuntime';

let hostScript: string;
let sandbox: string;
test.beforeAll(async () => {
  const bundle = async (entry: string, format: 'iife' | 'esm') =>
    (
      await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        platform: 'browser',
        format,
        define: { 'import.meta.env': '{}' },
      })
    ).outputFiles[0].text;
  hostScript = await bundle('e2e/helpers/panelActionsHarness.ts', 'esm');
  sandbox = createPanelSandboxDocument(await bundle('src/panels/sandboxEntry.ts', 'iife'));
});

const openHarness = async (page: Page, query = '') => {
  await page.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/panel-action-test')
      await route.fulfill({
        contentType: 'text/html',
        body: '<div id="host"></div><script type="module" src="/panel-action-host.js"></script>',
      });
    else if (path === '/panel-action-host.js')
      await route.fulfill({ contentType: 'text/javascript', body: hostScript });
    else if (path === '/panel-action-sandbox') await route.fulfill({ contentType: 'text/html', body: sandbox });
    else await route.abort();
  });
  await page.goto(`/panel-action-test${query}`);
  return page.frameLocator('iframe[title="Action test panel"]');
};

test('opaque panel requests control explicitly and tracks feedback and cancellation through the host', async ({
  page,
}) => {
  const panel = await openHarness(page);
  await expect(panel.locator('#auto')).toHaveText('automatic acquisition blocked');
  expect(await page.evaluate(() => (window as any).panelActionsHarness.sent)).toEqual([]);
  await panel.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(panel.locator('#state')).toContainText('Request robot control');
  expect(await page.evaluate(() => (window as any).panelActionsHarness.goals().length)).toBe(0);
  await panel.getByRole('button', { name: 'Request control', exact: true }).click();
  await expect(panel.locator('#state')).toHaveText('owned');
  await panel.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(panel.locator('#state')).toHaveText('moving');
  await page.evaluate(() => (window as any).panelActionsHarness.feedback());
  await expect(panel.locator('#progress')).toHaveText('0.5');
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(panel.locator('#state')).toHaveText('cancelling');
  await expect
    .poll(() => page.evaluate(() => (window as any).panelActionsHarness.cancels().length))
    .toBeGreaterThanOrEqual(2);
  await page.evaluate(() => (window as any).panelActionsHarness.finish(5));
  await expect(panel.locator('#state')).toHaveText('terminal 5');
  const cancels = await page.evaluate(() => (window as any).panelActionsHarness.cancels().length);
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as any).panelActionsHarness.cancels().length)).toBe(cancels);
  const sent = await page.evaluate(() => (window as any).panelActionsHarness.sent);
  expect(sent.filter((message: any) => message.action === 'acquire')).toHaveLength(1);
  expect(sent.find((message: any) => message.message?.op === 'send_action_goal').message.controlToken).toBe(
    'host-secret-token'
  );
});

test('the sandbox cannot send actions beyond its reviewed manifest grant', async ({ page }) => {
  const panel = await openHarness(page, '?denyActions');
  await panel.getByRole('button', { name: 'Request control', exact: true }).click();
  await expect(panel.locator('#state')).toHaveText('owned');
  await panel.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(panel.locator('#state')).toContainText('not permitted');
  expect(await page.evaluate(() => (window as any).panelActionsHarness.goals().length)).toBe(0);
});
