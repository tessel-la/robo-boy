import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

// Opt-in live integration. No ROS/WebSocket or action mocks are installed.
const endpoint = process.env.ROBOBOY_BT_E2E_URL;
async function connect(page: Page) {
  const url = new URL(endpoint!);
  await page.getByTitle('Advanced Options').click();
  await page.getByRole('radio', { name: 'Host or IP' }).check();
  await page.locator('#ros2Value').fill(url.hostname);
  await page.locator('#rosbridgePort').fill(url.port || '9090');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 30000 });
}
async function panel(page: Page) {
  if (!(await page.getByTestId('behavior-tree-panel').count())) {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  }
}
async function menuAction(page: Page, name: string) {
  await page.getByTestId('bt-menu-button').click();
  await page.getByRole('button', { name, exact: true }).click();
  if (name !== 'XML source') await page.getByRole('button', { name: 'Close menu', exact: true }).click();
}
async function importTree(page: Page, runtime: string, source: string) {
  await page.getByTestId('bt-menu-button').click();
  await page
    .locator('input[type="file"][accept=".json,.xml"]')
    .setInputFiles({ name: `${runtime}.xml`, mimeType: 'application/xml', buffer: Buffer.from(source) });
  await page.getByLabel('Behavior Tree engine').selectOption(runtime);
}

test.describe('native runtimes against Genesis ROS host', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!endpoint, 'Start the isolated Genesis BT image and set ROBOBOY_BT_E2E_URL.');
  for (const runtime of ['btcpp', 'py_trees'] as const) {
    test(`${runtime}: discover, load, run, node details, cancel, reset and rerun in the shared panel`, async ({
      page,
    }) => {
      test.setTimeout(120000);
      await page.goto('/');
      await connect(page);
      await panel(page);
      // Make RUNNING observable even on a busy browser/CI host.
      const moving = Buffer.from(
        JSON.stringify({ x: 0.01, translation_frame: 'world', duration: 1.2, timeout: 5 })
      ).toString('base64');
      const source = readFileSync(`examples/behavior_trees/genesis_${runtime}.xml`, 'utf8')
        .replace(/goal_b64="[^"]*"/, `goal_b64="${moving}"`)
        .replace('seconds="0.2"', 'seconds="0.8"');
      await importTree(page, runtime, source);
      await menuAction(page, 'XML source');
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await page.getByTestId('bt-menu-button').click();
      const engine = page.getByRole('switch', {
        name: runtime === 'btcpp' ? 'Enable BehaviorTree.CPP' : 'Enable py_trees',
      });
      await expect(engine).toBeEnabled({ timeout: 30000 });
      if (!(await engine.isChecked())) {
        await engine.click();
        await expect(engine).toBeChecked();
      }
      await engine.click();
      await expect(engine).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      await engine.click();
      await expect(engine).toBeChecked();
      await page.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(page.getByText(/Native validation passed/)).toBeVisible();
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.locator('.bt-native-node.status-running').first()).toBeVisible();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 30000 });
      await expect(page.locator('.bt-native-node.status-success')).toHaveCount(3);
      await expect(page.getByRole('log')).toHaveCount(0);
      await expect
        .poll(() =>
          page.getByTestId('bt-canvas').evaluate(content => {
            const bounds = content.getBoundingClientRect();
            return Array.from(content.querySelectorAll('.bt-native-node')).every(node => {
              const box = node.getBoundingClientRect();
              return (
                box.top >= bounds.top &&
                box.bottom <= bounds.bottom &&
                box.left >= bounds.left &&
                box.right <= bounds.right
              );
            });
          })
        )
        .toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${runtime}-states.png`) });
      await page.locator('.bt-native-node').filter({ hasText: 'Move 1 cm' }).click();
      const details = page.getByLabel('Node details', { exact: true });
      await expect(details).toContainText('action_name');
      await details.getByText('Execution details', { exact: true }).click();
      await expect(details).toContainText('progress');
      await expect(details).toContainText('result');
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await menuAction(page, 'Reset');
      await expect(page.getByTestId('bt-runtime-state')).toContainText('loaded');
      await menuAction(page, 'XML source');
      const encoded = Buffer.from(JSON.stringify({ x: 0.01, duration: 6, timeout: 8 })).toString('base64');
      const slow = source.replace(/goal_b64="[^"]*"/, `goal_b64="${encoded}"`);
      await page.getByLabel('Tree XML').fill(slow);
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('running');
      await page.getByTestId('bt-menu-button').click();
      await engine.click();
      await expect(engine).not.toBeChecked();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('stopped');
      await engine.click();
      await expect(engine).toBeChecked();
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('running');
      await menuAction(page, 'Cancel');
      await expect(page.getByTestId('bt-runtime-state')).toContainText('cancelled');
      await menuAction(page, 'Reset');
      await expect(page.getByTestId('bt-runtime-state')).toContainText('loaded');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('running');
      await page.reload();
      await connect(page);
      await panel(page);
      await expect(page.getByTestId('bt-runtime-state')).toBeVisible({ timeout: 30000 });
      await menuAction(page, 'XML source');
      await expect(page.getByLabel('Tree XML')).toHaveValue(slow);
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 30000 });
    });
    for (const variant of ['transfer', 'recovery']) {
      test(`${runtime}: ${variant} example visualizes subtrees, wired ports and multiple real actions`, async ({
        page,
      }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await connect(page);
        await panel(page);
        const source = readFileSync(`examples/behavior_trees/genesis_${variant}_${runtime}.xml`, 'utf8');
        await importTree(page, runtime, source);
        await page.getByTestId('bt-palette-toggle').click();
        await page.getByRole('button', { name: 'View subtree Pick', exact: true }).click();
        await page.getByRole('button', { name: 'Close node palette', exact: true }).first().click();
        await page.locator('.bt-native-node').filter({ hasText: 'Bind approach object' }).click();
        await expect(page.getByLabel('Node details', { exact: true })).toContainText('{object}');
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(page.locator('.bt-native-node.status-running').first()).toBeVisible();
        await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 40000 });
        await expect(page.locator('.bt-native-node').filter({ hasText: 'Grasp detected object' })).toHaveClass(
          /status-success/
        );
        await expect(page.getByRole('log')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`${runtime}-${variant}.png`) });
        await menuAction(page, 'XML source');
        await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      });
    }
  }
});
