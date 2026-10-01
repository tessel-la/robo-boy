import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installRosMock } from './helpers/rosMock';

async function openPanel(page: import('@playwright/test').Page) {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  if (!(await page.getByTestId('behavior-tree-panel').count())) {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  }
}

test('uses one shell for repeated JSON, C++ and py_trees repository loads, subtrees and engine selection', async ({
  page,
}, info) => {
  await openPanel(page);
  await expect(page.getByLabel('Behavior Tree engine')).toBeVisible();
  await page.evaluate(() => {
    (window as any).__btShell = [
      document.querySelector('[data-testid="behavior-tree-panel"]'),
      document.querySelector('[data-testid="bt-menu-button"]'),
      document.querySelector('[aria-label="Behavior Tree engine"]'),
    ];
  });
  const folder = info.outputPath('tree-repository');
  mkdirSync(folder, { recursive: true });
  const now = Date.now();
  writeFileSync(
    resolve(folder, 'visual.json'),
    JSON.stringify({
      tree: { id: 'repository-json', name: 'Repository JSON', nodes: [], edges: [], createdAt: now, updatedAt: now },
      version: '1.0.0',
    })
  );
  for (const id of ['btcpp', 'py_trees'])
    writeFileSync(resolve(folder, `${id}.xml`), readFileSync(`examples/behavior_trees/genesis_transfer_${id}.xml`));
  for (const name of ['visual.json', 'btcpp.xml', 'py_trees.xml', 'btcpp.xml', 'visual.json', 'py_trees.xml']) {
    await page.getByTestId('bt-menu-button').click();
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await page.locator('.bt-repository-files .bt-menu-tree-row').filter({ hasText: name }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const shell = (window as any).__btShell;
          return [
            shell[0] === document.querySelector('[data-testid="behavior-tree-panel"]'),
            shell[1] === document.querySelector('[data-testid="bt-menu-button"]'),
            shell[2] === document.querySelector('[aria-label="Behavior Tree engine"]'),
          ];
        })
      )
      .toEqual([true, true, true]);
    const engine = page.getByRole('group', { name: 'Behavior Tree engine' });
    const engineButton = (id: string) =>
      engine.getByRole('button', {
        name: id === 'btcpp' ? 'BehaviorTree.CPP' : id === 'json' ? 'Robo Boy' : 'py_trees',
        exact: true,
      });
    const id = name.replace('.xml', '');
    if (name.endsWith('.xml')) {
      await expect(engineButton(id)).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(() =>
          page.getByTestId('bt-canvas').evaluate(canvas => {
            const bounds = canvas.getBoundingClientRect();
            const nodes = Array.from(canvas.querySelectorAll('.bt-native-node'));
            return (
              nodes.length > 0 &&
              nodes.every(node => {
                const box = node.getBoundingClientRect();
                return (
                  box.width > 0 &&
                  box.height > 0 &&
                  box.left >= bounds.left &&
                  box.right <= bounds.right &&
                  box.top >= bounds.top &&
                  box.bottom <= bounds.bottom &&
                  getComputedStyle(node).visibility === 'visible'
                );
              })
            );
          })
        )
        .toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}-initial-render.png`) });
      await page.getByTestId('bt-menu-button').click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(name => {
            const trees = JSON.parse(localStorage.getItem('robo-boy-behavior-trees')!);
            return trees.find((saved: any) => saved.tree.name === name.replace('.xml', ''))?.tree.nativeDocument
              .runtime;
          }, name)
        )
        .toBe(id);
      await page.getByRole('button', { name: 'XML source', exact: true }).click();
      const source = readFileSync(`examples/behavior_trees/genesis_transfer_${id}.xml`, 'utf8');
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      await engineButton(id === 'btcpp' ? 'py_trees' : 'btcpp').click();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      await engineButton(id).click();
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await expect(page.getByRole('log')).toHaveCount(0);
      await expect(page.getByTestId('bt-undo')).toBeDisabled();
      await expect(page.getByTestId('bt-open-agent')).toBeDisabled();
      await page.getByTestId('bt-palette-toggle').click();
      await page.getByRole('button', { name: 'View subtree Pick', exact: true }).click();
      await page.getByRole('button', { name: 'Close node palette', exact: true }).first().click();
      await expect(page.locator('.bt-native-node').filter({ hasText: 'Bind approach object' })).toBeVisible();
      await page.getByRole('button', { name: 'Back to parent tree', exact: true }).click();
    } else await expect(engineButton('json')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bt-menu-button').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-behavior-trees')!));
  expect(
    stored.filter((item: any) => item.tree.nativeDocument).map((item: any) => item.tree.nativeDocument.runtime)
  ).toEqual(expect.arrayContaining(['btcpp', 'py_trees']));
  await page.setViewportSize({ width: 520, height: 820 });
  await expect
    .poll(() =>
      page.getByTestId('bt-canvas').evaluate(canvas => {
        const bounds = canvas.getBoundingClientRect();
        return Array.from(canvas.querySelectorAll('.bt-native-node')).every(node => {
          const box = node.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom
          );
        });
      })
    )
    .toBe(true);
  const toggle = await page.getByRole('group', { name: 'Behavior Tree engine' }).boundingBox();
  expect(toggle!.x).toBeGreaterThanOrEqual(0);
  expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(520);
  await expect
    .poll(() => page.getByTestId('bt-runtime-state').evaluate(chip => chip.scrollWidth <= chip.clientWidth))
    .toBe(true);
  await page.screenshot({ path: info.outputPath('py_trees-mobile-render.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('bt-menu-button').click();
  await page.getByRole('button', { name: 'XML source', exact: true }).click();
  const inspectorBox = await page.getByLabel('XML source editor').boundingBox();
  expect(inspectorBox).not.toBeNull();
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('xml-source-mobile.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('XML source editor')).toHaveCount(0);
  await page.getByTestId('bt-menu-button').click();
  await expect(page.getByRole('dialog', { name: 'Behavior tree menu' })).toBeVisible();
  await page.getByRole('switch', { name: 'Enable py_trees' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('xml-menu-mobile.png'), animations: 'disabled' });
});

test('folder imports have clear names and paths without GitHub controls', async ({ page }, info) => {
  await openPanel(page);
  await page.getByTestId('bt-menu-button').click();
  await expect(page.getByLabel('GitHub repository', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Browse repository', exact: true })).toHaveCount(0);
  const folder = info.outputPath('tasks');
  mkdirSync(resolve(folder, 'pick'), { recursive: true });
  writeFileSync(resolve(folder, 'pick', 'approach.xml'), readFileSync('examples/behavior_trees/genesis_btcpp.xml'));
  writeFileSync(resolve(folder, 'notes.txt'), 'ignored');
  await page.locator('input[webkitdirectory]').setInputFiles(folder);
  const list = page.getByRole('list', { name: 'Folder tree files' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  const file = list.getByRole('button', { name: 'Open tasks/pick/approach.xml', exact: true });
  await expect(file).toContainText('approach.xml');
  await expect(file).toContainText('pick');
  await page.getByLabel('Search repository trees').fill('missing');
  await expect(page.getByText('No matching tree files.', { exact: true })).toBeVisible();
  await page.getByLabel('Search repository trees').fill('approach');
  await file.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('folder-list.png'), animations: 'disabled' });
  await file.click();
  await expect(
    page
      .getByRole('group', { name: 'Behavior Tree engine' })
      .getByRole('button', { name: 'BehaviorTree.CPP', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Load on host', exact: true })).toHaveCount(0);
  await expect(page.locator('.bt-runtime-status')).toHaveCount(0);
});

test.describe('native mobile navigation and settings', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  for (const runtime of ['btcpp', 'py_trees'] as const) {
    test(`${runtime}: uses the shared Parent control and a contained main-tree picker`, async ({ page }, info) => {
      await openPanel(page);
      const source = `<root ${runtime === 'btcpp' ? 'BTCPP_format="4"' : ''} main_tree_to_execute="Main">
        <BehaviorTree ID="Main"><Sequence ${runtime === 'py_trees' ? 'memory="true"' : ''}><SubTree ID="Branch" name="Open branch"/><Wait seconds="0.2"/></Sequence></BehaviorTree>
        <BehaviorTree ID="Branch"><Sequence ${runtime === 'py_trees' ? 'memory="true"' : ''}><SubTree ID="Leaf" name="Open leaf"/></Sequence></BehaviorTree>
        <BehaviorTree ID="Leaf"><Wait name="Leaf wait" seconds="0.2"/></BehaviorTree>
      </root>`;
      await page.getByTestId('bt-menu-button').tap();
      await page.locator('input[type="file"][accept=".json,.xml"]').setInputFiles({
        name: `${runtime}.xml`,
        mimeType: 'application/xml',
        buffer: Buffer.from(source),
      });
      const openSubtree = async (name: string) => {
        const node = page.locator('.bt-native-node').filter({ hasText: name });
        await node.tap();
        await node.tap();
      };
      await openSubtree('Open branch');
      const parent = page.getByTestId('bt-subtree-parent');
      await expect(parent).toHaveText('Parent');
      await expect(parent).toHaveAttribute('aria-label', 'Back to parent tree');
      await expect(parent).toHaveClass('bt-subtree-parent-action');
      await openSubtree('Open leaf');
      await expect(page.locator('.bt-native-node')).toHaveCount(1);
      await expect(parent).toBeVisible();
      const canvas = page.getByTestId('bt-canvas');
      const assertContained = async () => {
        await expect
          .poll(async () => {
            const bounds = (await canvas.boundingBox())!;
            const button = (await parent.boundingBox())!;
            const node = (await page.locator('.bt-native-node').boundingBox())!;
            return (
              button.x >= bounds.x &&
              button.y >= bounds.y &&
              button.x + button.width <= bounds.x + bounds.width &&
              button.y + button.height <= bounds.y + bounds.height &&
              (button.y + button.height <= node.y || button.y >= node.y + node.height)
            );
          })
          .toBe(true);
      };
      await assertContained();
      await page.setViewportSize({ width: 520, height: 740 });
      // Let the panel's height transition and the resulting graph fit paint
      // before checking/capturing the resized navigation control.
      await canvas.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await assertContained();
      await page.screenshot({ path: info.outputPath('native-subtree-mobile.png'), animations: 'disabled' });
      await parent.tap();
      await expect(page.locator('.bt-native-node').filter({ hasText: 'Open leaf' })).toHaveCount(1);
      await parent.tap();
      await expect(parent).toHaveCount(0);
      await expect(page.locator('.bt-native-node').filter({ hasText: 'Open branch' })).toHaveCount(1);
      await page.getByTestId('bt-menu-button').tap();
      const picker = page.getByRole('button', { name: 'Main XML tree', exact: true });
      await picker.scrollIntoViewIfNeeded();
      await expect(picker).toHaveText('Main');
      await expect
        .poll(() => picker.evaluate(element => element.getBoundingClientRect().height))
        .toBeGreaterThanOrEqual(44);
      await picker.tap();
      const options = page.getByRole('listbox', { name: 'Main XML tree options' });
      await expect(options.getByRole('option', { name: 'Choose a tree' })).toBeDisabled();
      const box = (await options.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(520);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
      await page.screenshot({ path: info.outputPath('native-main-tree-picker.png'), animations: 'disabled' });
      await options.getByRole('option', { name: 'Branch', exact: true }).tap();
      await expect(picker).toHaveText('Branch');
      await page.getByRole('button', { name: 'Close menu', exact: true }).tap();
      await expect(page.locator('.bt-native-node')).toHaveCount(2);
      await expect(parent).toHaveCount(0);
    });
  }
});
