import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const endpoint = process.env.ROBOBOY_BT_E2E_URL;
const container = process.env.ROBOBOY_BT_E2E_CONTAINER;
function robot(script: string) {
  execFileSync('docker', ['exec', container!, 'bash', '-lc', script]);
}
function start(runtime: string) {
  const executable =
    runtime === 'btcpp' ? '/usr/local/bin/robo-boy-external-btcpp' : 'python3 /ros_ws/external_py_tree.py';
  robot(
    `source /opt/ros/jazzy/setup.bash; export PYTHONPATH=/opt/bt-venv/lib/python3.12/site-packages:$PYTHONPATH; ${executable} >/tmp/external-${runtime}.log 2>&1 & echo $! >/tmp/external-${runtime}.pid`
  );
}
function stop(runtime: string) {
  robot(
    `if [ -f /tmp/external-${runtime}.pid ]; then kill -TERM $(cat /tmp/external-${runtime}.pid) 2>/dev/null || true; rm /tmp/external-${runtime}.pid; fi`
  );
}
async function connect(page: Page) {
  const url = new URL(endpoint!);
  await page.getByTitle('Advanced Options').click();
  await page.getByRole('radio', { name: 'Host or IP' }).check();
  await page.locator('#ros2Value').fill(url.hostname);
  await page.locator('#rosbridgePort').fill(url.port);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 30000 });
}
async function panel(page: Page) {
  if (!(await page.getByTestId('behavior-tree-panel').count())) {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  }
}

test.describe('independent robot executors through real ROS telemetry', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!endpoint || !container, 'Requires task-owned isolated Genesis container and rosbridge URL.');
  for (const runtime of ['btcpp', 'py_trees']) {
    test(`${runtime}: automatically watch, inspect, lose telemetry, reconnect and preserve editor`, async ({
      page,
    }, info) => {
      test.setTimeout(90000);
      page.setDefaultTimeout(15000);
      start(runtime); // Starts before Robo Boy connects; never sends a managed load/start command.
      try {
        await page.goto('/');
        await connect(page);
        await panel(page);
        await expect(page.getByTestId('bt-runtime-state')).toContainText('Watching');
        await expect(page.locator('.bt-native-node')).toHaveCount(4);
        await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
        await expect(page.locator('.bt-native-node.status-running').first()).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${runtime}-watch-desktop.png`) });
        await page.locator('.bt-native-node').filter({ hasText: 'Approach' }).dblclick();
        await expect(page.locator('.bt-native-node')).toHaveCount(3);
        await expect(page.getByTestId('bt-subtree-parent')).toBeVisible();
        await page.locator('.bt-native-node').filter({ hasText: 'Robot wait' }).click();
        await expect(page.getByLabel('Node details')).toContainText(runtime === 'btcpp' ? 'seconds' : 'RobotWait');
        await page.getByRole('button', { name: 'Close inspector' }).click();
        await page.getByTestId('bt-subtree-parent').click();
        await expect(page.locator('.bt-native-node')).toHaveCount(4);
        stop(runtime);
        await expect(page.getByTestId('bt-runtime-state')).toHaveText('Telemetry lost');
        await expect(page.locator('.bt-native-node')).toHaveCount(4);
        start(runtime);
        await expect(page.getByTestId('bt-runtime-state')).toContainText('Watching');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: info.outputPath(`${runtime}-watch-mobile.png`) });
        await page.getByTestId('bt-menu-button').click();
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
        await page.getByRole('button', { name: 'Close menu', exact: true }).click();
        await expect(page.locator('.bt-native-node')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
        // Save a small native draft, then watch and return without replacing it.
        await page.getByTestId('bt-menu-button').click();
        await page
          .locator('input[type="file"][accept=".json,.xml"]')
          .setInputFiles({
            name: 'draft.xml',
            mimeType: 'application/xml',
            buffer: Buffer.from(
              '<root BTCPP_format="4" main_tree_to_execute="Draft"><BehaviorTree ID="Draft"><AlwaysSuccess name="My draft"/></BehaviorTree></root>'
            ),
          });
        await expect(page.locator('.bt-native-node')).toHaveCount(1);
        const close = page.getByRole('button', { name: 'Close menu', exact: true });
        if (await close.count()) await close.click();
        await page.getByTestId('bt-menu-button').click();
        await page
          .getByRole('button')
          .filter({ hasText: runtime === 'btcpp' ? 'ExternalCpp · BT.CPP' : 'ExternalPy · py_trees' })
          .click();
        await page.getByRole('button', { name: 'Close menu', exact: true }).click();
        await expect(page.locator('.bt-native-node')).toHaveCount(4);
        await page.getByTestId('bt-menu-button').click();
        await page.getByRole('button', { name: 'Back to editor', exact: true }).click();
        await page.getByRole('button', { name: 'Close menu', exact: true }).click();
        await expect(page.locator('.bt-native-node')).toHaveCount(1);
        await expect(page.locator('.bt-native-node')).toContainText('My draft');
      } finally {
        stop(runtime);
      }
    });
  }
});
