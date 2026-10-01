import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

// Opt-in live integration. No ROS/WebSocket or action mocks are installed.
const endpoint = process.env.ROBOBOY_BT_E2E_URL;
test.describe('native runtimes against Genesis ROS host', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!endpoint, 'Start the isolated Genesis BT image and set ROBOBOY_BT_E2E_URL.');
  for (const runtime of ['btcpp', 'py_trees'] as const) {
    test(`${runtime}: discover, load, run, feedback, cancel, reset and rerun`, async ({ page }) => {
      test.setTimeout(120000);
      const url = new URL(endpoint!);
      const connect = async () => {
        await page.getByTitle('Advanced Options').click();
        await page.getByRole('radio', { name: 'Host or IP' }).check();
        await page.locator('#ros2Value').fill(url.hostname);
        await page.locator('#rosbridgePort').fill(url.port || '9090');
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 30000 });
      };
      await page.goto('/');
      await connect();
      if (!(await page.getByTestId('behavior-tree-panel').count())) {
        await page.getByLabel('Add workspace panel').first().click();
        await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
      }
      await page.getByTestId('bt-menu-button').click();
      const source = readFileSync(`examples/behavior_trees/genesis_${runtime}.xml`, 'utf8');
      await page
        .locator('input[type="file"][accept=".json,.xml"]')
        .setInputFiles({ name: `${runtime}.xml`, mimeType: 'application/xml', buffer: Buffer.from(source) });
      await page.getByRole('button', { name: 'XML source', exact: true }).click();
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      await page.getByTestId('bt-menu-button').click();
      await page.getByLabel('XML runtime').selectOption(runtime);
      const engine = page.getByRole('switch', {
        name: runtime === 'btcpp' ? 'Enable BehaviorTree.CPP' : 'Enable py_trees',
      });
      // The controlled switch reflects host acknowledgement, which is asynchronous.
      if (!(await engine.isChecked())) {
        await engine.click();
        await expect(engine).toBeChecked();
      }
      await engine.click();
      await expect(engine).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      await engine.click();
      await expect(engine).toBeChecked();
      await expect(page.getByText(/Available on ROS host/)).toBeVisible({ timeout: 30000 });
      await page.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(page.getByText('Native validation passed.')).toBeVisible();
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByRole('button', { name: 'Tree states' }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.locator('.bt-native-node.status-running').first()).toBeVisible();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 30000 });
      await expect(page.locator('.bt-native-node.status-success')).toHaveCount(3);
      await expect(page.getByRole('log')).toContainText('progress');
      await expect(page.getByRole('log')).toContainText('result');
      await expect.poll(async () => page.locator('.bt-native-content').evaluate(content => {
        const bounds = content.getBoundingClientRect();
        return Array.from(content.querySelectorAll('.bt-native-node')).every(node => {
          const box = node.getBoundingClientRect();
          return box.top >= bounds.top && box.bottom <= bounds.bottom &&
            box.left >= bounds.left && box.right <= bounds.right;
        });
      })).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${runtime}-states.png`) });
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('loaded');
      await page.getByRole('button', { name: 'XML source', exact: true }).click();
      await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      // Slow the same Genesis action so cancellation is observable on both backends.
      const encoded = Buffer.from(JSON.stringify({ x: 0.01, duration: 6, timeout: 8 })).toString('base64');
      const slow = source.replace(/goal_b64="[^"]*"/, `goal_b64="${encoded}"`);
      await page.getByLabel('Tree XML').fill(slow);
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
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('cancelled');
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('loaded');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('running');
      await page.reload();
      await connect();
      if (!(await page.getByTestId('behavior-tree-panel').count())) {
        await page.getByLabel('Add workspace panel').first().click();
        await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
      }
      await page.getByRole('button', { name: 'XML source', exact: true }).click();
      await expect(page.getByLabel('Tree XML')).toHaveValue(slow, { timeout: 30000 });
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 30000 });
    });
  }
});
