import { openAppTool } from './helpers/navigation';
import { expect, test } from '@playwright/test';
import { installRosMock, getPublishedRosMessages, getRosServiceCalls } from './helpers/rosMock';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const pandaSource = JSON.stringify({
  ...JSON.parse(readFileSync(resolve('library/generic/panda-inspection/1.0.0.json'), 'utf8')),
  id: 'community.panda',
});
const catalog = JSON.parse(readFileSync(resolve('library/catalog.json'), 'utf8'));
for (const theme of ['dark', 'light', 'solarized', 'cobalt'])
  for (const width of [1280, 390]) {
    test(`Library review and independent workspace in ${theme} at ${width}px`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
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
      await page.getByRole('button', { name: /Switch connections, current/ }).click();
      await page.getByRole('button', { name: 'Catalog', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Catalog', exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
      await dialog.getByRole('button', { name: 'Select multiple' }).click();
      await dialog.getByLabel('Select Panda inspection').check();
      await dialog.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
      await expect(dialog.getByText('Import contents', { exact: true })).toBeVisible();
      expect(await dialog.locator('canvas,iframe').count()).toBe(0);
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await dialog.screenshot({ path: `/tmp/roboboy-library-${browserName}-${theme}-${width}.png` });
      await dialog.getByRole('button', { name: 'Import 1 collection', exact: true }).click();
      await expect(dialog).toContainText('Imported successfully.');
      expect(await page.locator('.workspace-card').count()).toBe(0);
      await expect(dialog.getByRole('button', { name: /^(Open layout|Open tree|Add Pad)$/ })).toHaveCount(0);
      await expect(dialog.getByLabel('Source')).toHaveValue('roboboy-official-content');
      await expect(dialog.getByRole('heading', { name: 'Preview', exact: true })).toHaveCount(0);
      await dialog.screenshot({ path: `/tmp/roboboy-import-success-${browserName}-${theme}-${width}.png` });
      await dialog.getByRole('button', { name: 'Saved', exact: true }).click();
      await dialog.getByRole('button', { name: /^Panda inspection/ }).click();
      await dialog.getByRole('button', { name: 'Open layout', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.workspace-card')).toHaveCount(width < 800 ? 2 : 3);
      if (width >= 800) await expect(page.locator('.bt-float-name')).toHaveText('Readiness example');
      await page.getByRole('button', { name: /Switch connections, current/ }).click();
      await expect(page.getByRole('button', { name: 'Workspace layouts', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Manage panels', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Catalog', exact: true }).click();
      await expect(dialog.getByRole('button', { name: /^Panda inspection/ })).toBeVisible();
      await dialog.getByRole('button', { name: /^Panda inspection/ }).click();
      await expect(dialog.getByRole('button', { name: 'Open layout', exact: true })).toBeVisible();
      if (width < 761) await dialog.getByRole('button', { name: '← Back' }).click();
      await dialog.getByRole('button', { name: /^Joint readout/ }).click();
      await expect(dialog.getByRole('button', { name: 'Add Pad', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(await getPublishedRosMessages(page, '/cmd_vel')).toEqual([]);
      expect(await getRosServiceCalls(page, '/import-danger')).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
test('custom HTTPS catalog persists offline with exact cached content and imports without activation', async ({
  page,
}) => {
  await page.route('https://library.example/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: route.request().url().endsWith('catalog.json')
        ? JSON.stringify({
            ...catalog,
            title: 'Panda community',
            items: [
              {
                ...catalog.items[0],
                id: 'community.panda',
                sha256: createHash('sha256').update(pandaSource).digest('hex'),
                url: 'panda.json',
              },
            ],
          })
        : pandaSource,
    })
  );
  await page.goto('/');
  await openAppTool(page, 'Catalog');
  const dialog = page.getByRole('dialog', { name: 'Catalog', exact: true });
  await dialog
    .locator('summary')
    .filter({ hasText: /^Import$/ })
    .click();
  await dialog.getByRole('button', { name: 'Online catalog…', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Catalog URL' }).fill('https://library.example/catalog.json');
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(dialog.getByLabel('Source')).toContainText('Panda community');
  await dialog.getByRole('button', { name: /^Panda inspection/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Preview', exact: true })).toBeVisible();
  await page.reload();
  await page.route('https://library.example/**', route => route.abort());
  await openAppTool(page, 'Catalog');
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await dialog.getByLabel('Source').selectOption({ label: 'Panda community' });
  await dialog.getByRole('button', { name: 'Import all', exact: true }).click();
  await expect(dialog.getByText('Import contents', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 1 collection', exact: true }).click();
  await expect(dialog).toContainText('Imported successfully.');
  expect(await page.locator('.workspace-card').count()).toBe(0);
});
test('imports an entire robot repository folder with the verified catalog', async ({ page }) => {
  await page.goto('/');
  await openAppTool(page, 'Catalog');
  const dialog = page.getByRole('dialog', { name: 'Catalog', exact: true });
  await dialog.getByLabel('Catalog folder').setInputFiles(resolve('library'));
  await expect(dialog).toContainText('Folder added');
  await dialog.getByRole('button', { name: 'Import all', exact: true }).click();
  await expect(dialog.getByText('Import contents', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: `Import ${catalog.items.length} collections`, exact: true }).click();
  await expect(dialog).toContainText('Imported successfully.');
});

test('imports and opens Genesis controls without publishing servo commands', async ({ page }) => {
  await installRosMock(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByRole('button', { name: /Switch connections, current/ }).click();
  await page.getByRole('button', { name: 'Catalog', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Catalog', exact: true });
  await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
  await dialog.getByRole('button', { name: 'Select multiple' }).click();
  await dialog.getByLabel('Select Genesis control').check();
  await dialog.getByRole('button', { name: 'Import selected (1)', exact: true }).click();
  await expect(dialog.getByText('Import contents', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('Move Genesis X Y');
  expect(await getPublishedRosMessages(page, '/arm_1/servo_node/delta_twist_cmds')).toEqual([]);
  await dialog.getByRole('button', { name: 'Import 1 collection', exact: true }).click();
  await expect(dialog).toContainText('Imported successfully.');
  await expect(dialog.getByRole('button', { name: 'Add Pad', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Saved', exact: true }).click();
  await dialog.getByRole('button', { name: /^Genesis control/ }).click();
  await dialog.getByRole('button', { name: 'Open layout', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.workspace-card')).toHaveCount(4);
  await expect(page.getByText('Linear Motion', { exact: true })).toBeVisible();
  await expect(page.getByText('Angular Motion', { exact: true })).toBeVisible();
  await expect(page.getByText('Linear Z', { exact: true })).toBeVisible();
  expect(await getPublishedRosMessages(page, '/arm_1/servo_node/delta_twist_cmds')).toEqual([]);
  await page.getByRole('button', { name: /Switch connections, current/ }).click();
  await page.getByRole('button', { name: 'Catalog', exact: true }).click();
  await dialog.getByRole('button', { name: /^Move Genesis X Y/ }).click();
  await dialog.getByRole('button', { name: 'Open tree', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.bt-float-name')).toHaveText('Move Genesis X Y');
  expect(await getPublishedRosMessages(page, '/arm_1/servo_node/delta_twist_cmds')).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  const freshTree = page.locator('.workspace-card-behaviorTree').last();
  await freshTree.getByTestId('bt-menu-button').click();
  const imported = page.locator('.bt-menu-tree-row').filter({ hasText: 'Move Genesis X Y' });
  await expect(imported).toContainText('Imported');
  await expect(imported.getByRole('button', { name: 'Delete tree' })).toHaveCount(0);
  await imported.click();
  await expect(freshTree.locator('.bt-float-name')).toHaveText('Move Genesis X Y');
  expect(await getPublishedRosMessages(page, '/arm_1/servo_node/delta_twist_cmds')).toEqual([]);
});

for (const width of [1280, 390])
  test(`finds imported Pads and layouts in their usual pickers after reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installRosMock(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await openAppTool(page, 'Catalog');
    const dialog = page.getByRole('dialog', { name: 'Catalog', exact: true });
    await dialog.getByRole('button', { name: 'Browse', exact: true }).click();
    await dialog.getByRole('button', { name: /^Panda inspection/ }).click();
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import 1 collection', exact: true }).click();
    await expect(dialog).toContainText('Imported successfully.');
    await page.keyboard.press('Escape');
    expect(await page.locator('.workspace-card').count()).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await openAppTool(page, 'Workspace layouts');
    await expect(page.getByRole('button', { name: 'Load Panda inspection', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Panda inspection', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load Panda inspection', exact: true }).click();
    await expect(page.locator('.workspace-card')).toHaveCount(width < 800 ? 2 : 3);
    await page.getByRole('button', { name: 'Pad settings', exact: true }).click();
    const picker = page.getByLabel('Pad layout', { exact: true });
    await expect(picker.getByRole('option', { name: 'Joint readout · Template', exact: true })).toHaveCount(1);
    const value = await picker.inputValue();
    expect(value).toMatch(/^library:/);
    await expect(picker.getByRole('option', { selected: true })).toHaveText('Joint readout · Template');
    expect(await getPublishedRosMessages(page, '/cmd_vel')).toEqual([]);
    expect(await getRosServiceCalls(page, '/import-danger')).toEqual([]);
  });
