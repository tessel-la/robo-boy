import { expect, test, type Page } from '@playwright/test';
import { installRosMock, getPublishedRosMessages, getRosServiceCalls } from './helpers/rosMock';

const savedKey = 'robo-boy-desktop-workspace-saved-layouts-v1';
const workspace = {
  version: 2,
  gamepads: [
    {
      id: 'drive',
      name: 'Imported drive',
      components: [
        {
          id: 'button',
          type: 'button',
          position: { x: 0, y: 0, width: 2, height: 1 },
          label: 'Danger',
          eventOperations: { press: { kind: 'service', name: '/import-danger', messageType: 'std_srvs/srv/Trigger' } },
        },
      ],
    },
  ],
  layouts: [
    {
      id: 'navigation',
      title: 'Navigation template',
      panels: [
        { id: 'drive-panel', type: 'pad', title: 'Pad', layoutId: 'drive' },
        { id: 'scene', type: '3d', title: 'Scene', visualization: { fixedFrame: 'map', visualizations: [] } },
      ],
      tileOrder: ['scene', 'drive-panel'],
      layout: {
        version: 2,
        root: {
          type: 'split',
          axis: 'x',
          ratio: 0.5,
          first: { type: 'tile', id: 'scene' },
          second: { type: 'tile', id: 'drive-panel' },
        },
      },
    },
  ],
};
const upload = (value: unknown) => ({
  name: 'template.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(value)),
});
async function savedLayouts(page: Page) {
  return page.evaluate(
    key =>
      Object.entries(localStorage)
        .filter(([name]) => name.startsWith(key))
        .flatMap(([, value]) => JSON.parse(value)),
    savedKey
  );
}
async function layoutsMenu(page: Page) {
  if (!(await page.getByLabel('Import layouts', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: /Switch connections, current/ }).click();
    await page.getByRole('button', { name: 'Workspace layouts', exact: true }).click();
  }
}
for (const theme of ['dark', 'light', 'solarized', 'cobalt'])
  for (const width of [1280, 390]) {
    test(`reviews workspace imports with ${theme} at ${width}px`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height: 850 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await installRosMock(page);
      await page.addInitScript(theme => {
        localStorage.setItem('appTheme', theme);
        localStorage.setItem(
          'customThemes',
          JSON.stringify([
            {
              id: 'cobalt',
              name: 'Cobalt',
              colors: {
                primary: '#FF8722',
                secondary: '#9FB3FF',
                background: '#1A2A78',
                text: '#F4F1FF',
                border: '#3E5FD8',
                cardBg: '#22348F',
                buttonText: '#121212',
              },
            },
          ])
        );
      }, theme);
      await page.goto('/');
      await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
      await expect(page.getByLabel('Status: Connected')).toBeVisible();
      await layoutsMenu(page);
      const input = page.locator('.workspace-template-transfer-row input[type=file]');
      await input.setInputFiles(upload(workspace));
      const dialog = page.getByRole('dialog', { name: 'Import workspace layouts' });
      await expect(dialog).toContainText('Navigation template');
      await expect(dialog).toContainText('Imported drive');
      expect(await savedLayouts(page)).toHaveLength(0);
      expect(await dialog.locator('canvas, iframe').count()).toBe(0);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const cancel = dialog.getByRole('button', { name: 'Cancel' });
      await cancel.focus();
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Import' })).toBeFocused();
      await dialog.screenshot({ path: `/tmp/roboboy-content-import-${browserName}-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await savedLayouts(page)).toHaveLength(0);
      await input.setInputFiles(upload(workspace));
      await dialog.getByRole('button', { name: 'Import' }).click();
      await expect.poll(() => savedLayouts(page)).toHaveLength(1);
      await layoutsMenu(page);
      await input.setInputFiles(upload(workspace));
      await dialog.getByRole('button', { name: 'Import' }).click();
      await expect.poll(() => savedLayouts(page)).toHaveLength(2);
      const layouts = await savedLayouts(page);
      expect(layouts[0].panels[0].id).not.toBe(layouts[1].panels[0].id);
      expect(layouts[0].panels[0].layoutId).not.toBe(layouts[1].panels[0].layoutId);
      expect(await page.locator('.workspace-panel').count()).toBe(0);
      expect(await getPublishedRosMessages(page, '/cmd_vel')).toEqual([]);
      expect(await getRosServiceCalls(page, '/import-danger')).toEqual([]);
      await layoutsMenu(page);
      await input.setInputFiles(upload({ ...workspace, version: 99 }));
      await expect(page.getByRole('dialog', { name: 'Unable to import' })).toContainText(
        'Unsupported workspace file version'
      );
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      expect(await savedLayouts(page)).toHaveLength(2);
      expect(errors).toEqual([]);
    });
  }

test('reviews Pad and BT files in their existing menus without activating controls or executing trees', async ({
  page,
}) => {
  await installRosMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Pad controls', exact: true }).click();
  await page.getByRole('button', { name: 'Pad settings' }).click();
  const selected = await page.getByLabel('Pad layout', { exact: true }).inputValue();
  const padFile = page.locator('input[type=file][accept=".json,application/json"]');
  await padFile.setInputFiles(upload({ layouts: workspace.gamepads }));
  const review = page.getByRole('dialog', { name: 'Import Pads' });
  await expect(review).toContainText('Imported drive');
  await review.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByLabel('Pad layout', { exact: true })).toHaveValue(selected);
  await expect(
    page.getByLabel('Pad layout', { exact: true }).getByRole('option', { name: 'Imported drive · Custom' })
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Close pad settings', exact: true }).click();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  await page.getByTestId('bt-menu-button').click();
  const btFile = page.locator('.bt-menu-panel input[type=file]');
  const tree = {
    id: 'original',
    name: 'Patrol template',
    nodes: [
      {
        id: 'service',
        type: 'service',
        position: { x: 0, y: 0 },
        data: {
          label: 'Reset',
          serviceName: '/import-danger',
          serviceType: 'std_srvs/srv/Trigger',
          request: {},
          status: 'running',
        },
      },
    ],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  };
  await btFile.setInputFiles(upload({ version: '1.0.0', tree }));
  const btReview = page.getByRole('dialog', { name: 'Import Behavior Tree' });
  await expect(btReview).toContainText('Unsaved editor changes will be replaced');
  await btReview.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.bt-float-name')).toHaveText('Patrol template');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  expect(await getRosServiceCalls(page, '/import-danger')).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-behavior-trees') ?? '[]'))).toHaveLength(
    1
  );
  await page.reload();
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByTestId('bt-menu-button').click();
  await page.locator('.bt-menu-tree-row').filter({ hasText: 'Patrol template' }).click();
  await expect(page.locator('.bt-float-name')).toHaveText('Patrol template');
  expect(await getRosServiceCalls(page, '/import-danger')).toEqual([]);
});
