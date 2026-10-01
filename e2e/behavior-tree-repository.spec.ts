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
    await page.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }).click();
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
    const engine = page.getByLabel('Behavior Tree engine');
    const id = name.replace('.xml', '');
    if (name.endsWith('.xml')) {
      await expect(engine).toHaveValue(id === 'py_trees' ? '' : 'btcpp');
      await engine.selectOption(id);
      await expect(engine).toHaveValue(id);
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
      await engine.selectOption(id === 'btcpp' ? 'py_trees' : 'btcpp');
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      await engine.selectOption(id);
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await expect(page.getByRole('log')).toHaveCount(0);
      await expect(page.getByTestId('bt-undo')).toBeDisabled();
      await expect(page.getByTestId('bt-open-agent')).toBeDisabled();
      await page.getByTestId('bt-palette-toggle').click();
      await page.getByRole('button', { name: 'View subtree Pick', exact: true }).click();
      await page.getByRole('button', { name: 'Close node palette', exact: true }).first().click();
      await expect(page.locator('.bt-native-node').filter({ hasText: 'Bind approach object' })).toBeVisible();
      await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
    } else await expect(engine).toHaveValue('json');
    await page.getByTestId('bt-menu-button').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-behavior-trees')!));
  expect(
    stored.filter((item: any) => item.tree.nativeDocument).map((item: any) => item.tree.nativeDocument.runtime)
  ).toEqual(expect.arrayContaining(['btcpp', 'py_trees']));
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

test('browses public GitHub trees through the shared JSON/XML menu', async ({ page }) => {
  const source = readFileSync('examples/behavior_trees/genesis_btcpp.xml', 'utf8');
  const sha = 'a'.repeat(40);
  await page.route('https://api.github.com/repos/example/trees**', async route => {
    const url = route.request().url();
    const body = url.includes('/git/blobs/')
      ? { encoding: 'base64', content: Buffer.from(source).toString('base64') }
      : url.includes('/git/trees/')
        ? { tree: [{ type: 'blob', path: 'examples/native.xml', sha, size: source.length }] }
        : { default_branch: 'dev' };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
  });
  await openPanel(page);
  await page.getByTestId('bt-menu-button').click();
  await page.getByLabel('GitHub repository', { exact: true }).fill('example/trees');
  await page.getByRole('button', { name: 'Browse repository', exact: true }).click();
  await page.getByRole('button', { name: 'examples/native.xml XML', exact: true }).click();
  await page.getByTestId('bt-menu-button').click();
  await page.getByRole('button', { name: 'XML source', exact: true }).click();
  await expect(page.getByLabel('Tree XML')).toHaveValue(source);
});
