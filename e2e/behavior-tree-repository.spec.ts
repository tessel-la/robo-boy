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

test('opens JSON, C++ XML and py_trees XML from the same repository folder and saves them', async ({ page }, info) => {
  await openPanel(page);
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
    writeFileSync(resolve(folder, `${id}.xml`), readFileSync(`examples/behavior_trees/genesis_${id}.xml`));
  for (const name of ['visual.json', 'btcpp.xml', 'py_trees.xml']) {
    await page.getByTestId('bt-menu-button').click();
    await page.locator('input[webkitdirectory]').setInputFiles(folder);
    await page.getByRole('button', { name: new RegExp(name.replace('.', '\\.')) }).click();
    if (name.endsWith('.xml')) {
      await page.getByRole('button', { name: 'XML source', exact: true }).click();
      const id = name.replace('.xml', '');
      await expect(page.getByLabel('Tree XML')).toHaveValue(
        readFileSync(`examples/behavior_trees/genesis_${id}.xml`, 'utf8')
      );
      await page.getByTestId('bt-menu-button').click();
      await page.getByLabel('XML runtime').selectOption(id);
    } else await page.getByTestId('bt-menu-button').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-behavior-trees')!));
  expect(stored).toHaveLength(3);
  expect(
    stored
      .filter((item: any) => item.tree.nativeDocument)
      .map((item: any) => item.tree.nativeDocument.runtime)
      .sort()
  ).toEqual(['btcpp', 'py_trees']);
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = page.locator('.bt-native-execution-controls');
  const sourceEditor = page.getByLabel('Tree XML');
  const controlsBox = await controls.boundingBox();
  const sourceBox = await sourceEditor.boundingBox();
  expect(controlsBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(sourceBox!.y);
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('xml-source-mobile.png'), animations: 'disabled' });
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
  await page.getByRole('button', { name: 'XML source', exact: true }).click();
  await expect(page.getByLabel('Tree XML')).toHaveValue(source);
});
