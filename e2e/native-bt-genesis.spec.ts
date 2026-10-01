import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
  await expect(
    page
      .getByRole('group', { name: 'Behavior Tree engine' })
      .getByRole('button', { name: runtime === 'btcpp' ? 'BehaviorTree.CPP' : 'py_trees', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
}

test.describe('native runtimes against Genesis ROS host', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(!endpoint, 'Start the isolated Genesis BT image and set ROBOBOY_BT_E2E_URL.');
  for (const runtime of ['btcpp', 'py_trees'] as const) {
    test(`${runtime}: visually build, compose repository subtrees, edit ports and execute`, async ({ page }, info) => {
      test.setTimeout(90000);
      page.setDefaultTimeout(15000);
      await page.goto('/');
      await connect(page);
      await panel(page);
      await page
        .getByRole('group', { name: 'Behavior Tree engine' })
        .getByRole('button', {
          name: runtime === 'btcpp' ? 'BehaviorTree.CPP' : 'py_trees',
          exact: true,
        })
        .click();
      await page.getByTestId('bt-menu-button').click();
      await page.getByRole('button', { name: 'New', exact: true }).click();
      const confirm = page.getByRole('button', { name: 'Create new tree', exact: true });
      if (await confirm.count()) await confirm.click();
      const closeMenu = page.getByRole('button', { name: 'Close menu', exact: true });
      if (await closeMenu.count()) await closeMenu.click();
      await expect(page.locator('.bt-native-node')).toHaveCount(1);
      await page.getByTestId('bt-palette-toggle').click();
      await page.getByLabel('Search native nodes and subtrees').fill('Wait');
      const canvas = page.getByTestId('bt-canvas');
      const box = (await canvas.boundingBox())!;
      const entryButton = page.getByRole('button', { name: 'Add Wait node', exact: true });
      await entryButton.hover();
      const entry = (await entryButton.boundingBox())!;

      await page.mouse.move(entry.x + entry.width / 2, entry.y + entry.height / 2);
      await page.mouse.down();
      await page.mouse.move(entry.x + entry.width / 2 + 12, entry.y + entry.height / 2, { steps: 3 });
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.65, { steps: 12 });
      await page.mouse.move(box.x + box.width * 0.75 + 1, box.y + box.height * 0.65 + 1);
      await page.mouse.up();
      await page.getByRole('button', { name: 'Close node palette', exact: true }).first().click();
      await expect(page.locator('.bt-native-node')).toHaveCount(2);
      await expect(page.getByRole('alert')).toContainText('Connect all nodes');
      await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
      // Preserve a disconnected draft through local Save and reload.
      await menuAction(page, 'Save');
      await page.reload();
      await connect(page);
      await panel(page);
      await page.getByTestId('bt-menu-button').click();
      await page.locator('.bt-menu-tree-list .bt-menu-tree-row').filter({ hasText: 'XML tree' }).click();
      await expect(page.locator('.bt-native-node')).toHaveCount(2);
      await expect(page.getByRole('alert')).toContainText('Connect all nodes');
      const root = page.locator('.react-flow__node-native').filter({ hasText: 'Root' });
      const wait = page.locator('.react-flow__node-native').filter({ hasText: 'Wait' });
      const connectHandles = async () => {
        await root.locator('.react-flow__handle-bottom').hover();
        const from = (await root.locator('.react-flow__handle-bottom').boundingBox())!;
        const to = (await wait.locator('.react-flow__handle-top').boundingBox())!;
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
        await page.mouse.up();
        await expect(page.locator('.react-flow__edge')).toHaveCount(1);
      };
      await connectHandles();
      await wait.click();
      await page.getByLabel('Node attribute seconds').fill('0.8');
      await page.getByLabel('Node attribute seconds').press('Enter');
      await page.getByRole('button', { name: 'Detach node', exact: true }).click();
      await expect(page.locator('.react-flow__edge')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await page.getByTestId('bt-undo').click();
      await expect(page.locator('.react-flow__edge')).toHaveCount(1);
      await page.getByTestId('bt-redo').click();
      await expect(page.locator('.react-flow__edge')).toHaveCount(0);
      await connectHandles();
      const folder = info.outputPath('subtree-library');
      mkdirSync(folder, { recursive: true });
      const source = `<root ${runtime === 'btcpp' ? 'BTCPP_format="4"' : ''}>
        <!-- reusable library -->
        <BehaviorTree ID="Task" ${runtime === 'py_trees' ? 'delay="0.2"' : ''}><Sequence ${runtime === 'py_trees' ? 'memory="true"' : ''}><SubTree ID="WaitPhase" seconds="{delay}"/></Sequence></BehaviorTree>
        <BehaviorTree ID="WaitPhase"><Wait name="Library wait" seconds="{seconds}"/></BehaviorTree>
        <TreeNodesModel><SubTree ID="Task"><input_port name="delay" default="0.2"/></SubTree></TreeNodesModel>
      </root>`;
      writeFileSync(resolve(folder, 'tasks.xml'), source);
      await page.getByTestId('bt-menu-button').click();
      await page.locator('input[webkitdirectory]').setInputFiles(folder);
      await page.getByRole('button', { name: /Add subtrees from .*tasks\.xml$/ }).click();
      await expect(page.getByLabel('Main XML tree')).toHaveValue('Main');
      // Collision errors do not replace or partially modify the current document.
      await page.getByRole('button', { name: /Add subtrees from .*tasks\.xml$/ }).click();
      await expect(page.getByRole('alert')).toContainText('already exists');
      await page.getByLabel('Library prefix').fill('extra');
      await page.getByRole('button', { name: /Add subtrees from .*tasks\.xml$/ }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByTestId('bt-palette-toggle').click();
      await page.getByLabel('Search native nodes and subtrees').fill('Task');
      await expect(page.getByRole('button', { name: 'Add subtree extra_Task', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add subtree Task', exact: true }).click();
      await page.getByRole('button', { name: 'Close node palette', exact: true }).first().click();
      await expect(page.locator('.bt-native-node')).toHaveCount(3);
      const task = page.locator('.bt-native-node').filter({ hasText: 'Task' });
      await task.click();
      await expect(page.getByLabel('Node attribute delay')).toHaveValue('0.2');
      await page.getByLabel('Node attribute delay').fill('0.4');
      await page.getByLabel('Node attribute delay').press('Enter');
      await page.getByRole('button', { name: 'Earlier', exact: true }).click();
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await menuAction(page, 'XML source');
      await expect(page.getByLabel('Tree XML')).toHaveValue(/reusable library/);
      const xml = await page.getByLabel('Tree XML').inputValue();
      expect(xml.indexOf('ID="Task" delay="0.4"')).toBeLessThan(xml.indexOf('seconds="0.8"'));
      await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
      await page.getByTestId('bt-menu-button').click();
      await page.getByRole('button', { name: 'Validate', exact: true }).click();
      await expect(page.getByText('Native validation passed.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('running');
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success');
      await expect(task).toHaveClass(/status-success/);
      await task.dblclick();
      await expect(page.locator('.bt-native-node').filter({ hasText: 'WaitPhase' })).toHaveClass(/status-success/);
      await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
      await menuAction(page, 'Reset');
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success');
      await page.screenshot({ path: info.outputPath(`${runtime}-composed.png`) });
      await page.getByTestId('bt-menu-button').click();
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const download = await downloaded;
      expect(readFileSync((await download.path())!, 'utf8')).toBe(xml);
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await importTree(page, runtime, xml);
      await expect(page.locator('.bt-native-node')).toHaveCount(3);
      await task.click();
      await page.getByRole('button', { name: 'Delete branch', exact: true }).click();
      await expect(page.locator('.bt-native-node')).toHaveCount(2);
      await page.getByTestId('bt-undo').click();
      await expect(page.locator('.bt-native-node')).toHaveCount(3);
    });
    test(`${runtime}: repeated nested subtrees keep live instance state and a stable viewport`, async ({ page }) => {
      test.setTimeout(60000);
      await page.goto('/');
      await connect(page);
      await panel(page);
      const source = `<root ${runtime === 'btcpp' ? 'BTCPP_format="4"' : ''} main_tree_to_execute="Main">
        <BehaviorTree ID="Main"><Sequence ${runtime === 'py_trees' ? 'memory="true"' : ''}>
          <SubTree ID="Work" name="First instance"/><SubTree ID="Work" name="Second instance"/>
        </Sequence></BehaviorTree>
        <BehaviorTree ID="Work"><Sequence><SubTree ID="Leaf" name="Nested wait"/></Sequence></BehaviorTree>
        <BehaviorTree ID="Leaf"><Wait name="Live leaf" seconds="3"/></BehaviorTree>
      </root>`;
      await importTree(page, runtime, source);
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      const first = page.locator('.bt-native-node').filter({ hasText: 'First instance' });
      const second = page.locator('.bt-native-node').filter({ hasText: 'Second instance' });
      await expect(first).toHaveClass(/status-running/);
      await expect(second).toHaveClass(/status-idle/);
      await first.dblclick();
      const nested = page.locator('.bt-native-node').filter({ hasText: 'Nested wait' });
      await expect(nested).toHaveClass(/status-running/);
      await nested.dblclick();
      await expect(page.locator('.bt-native-node').filter({ hasText: 'Live leaf' })).toHaveClass(/status-running/);
      await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
      await expect(nested).toBeVisible();
      await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
      await expect(second).toHaveClass(/status-running/, { timeout: 10000 });
      await expect(first).toHaveClass(/status-success/);
      await second.dblclick();
      await nested.dblclick();
      const leaf = page.locator('.bt-native-node').filter({ hasText: 'Live leaf' });
      await expect(leaf).toHaveClass(/status-running/);
      await page.getByRole('button', { name: 'zoom out', exact: true }).click();
      await page.waitForTimeout(350);
      const viewport = page.locator('.react-flow__viewport');
      const transform = await viewport.getAttribute('style');
      await page.waitForTimeout(400);
      await expect(viewport).toHaveAttribute('style', transform!);
      await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 10000 });
      await expect(leaf).toHaveClass(/status-success/);
      await menuAction(page, 'Reset');
      await expect(leaf).toHaveClass(/status-idle/);
      await page.getByRole('button', { name: 'Run', exact: true }).click();
      // Rerun keeps this second instance open; it remains idle while the first runs.
      await expect(leaf).toHaveClass(/status-idle/);
      await expect(page.getByRole('button', { name: 'Parent tree', exact: true })).toBeVisible();
      await menuAction(page, 'Cancel');
    });
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
      // Initial render must measure and paint every node before any node hover.
      await expect
        .poll(() =>
          page
            .locator('.react-flow__node-native')
            .evaluateAll(
              nodes =>
                nodes.length > 0 &&
                nodes.every(
                  node =>
                    getComputedStyle(node).visibility === 'visible' &&
                    node.getBoundingClientRect().height > 80 &&
                    node.getBoundingClientRect().width > 100
                )
            )
        )
        .toBe(true);
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
      // Wheel navigation turns Follow off and remains stable across streamed ticks.
      const follow = page.getByTestId('bt-follow-mode');
      if ((await follow.getAttribute('aria-pressed')) === 'false') await follow.click();
      const canvas = page.getByTestId('bt-canvas');
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -180);
      await expect(follow).toHaveAttribute('aria-pressed', 'false');
      const viewport = page.locator('.react-flow__viewport');
      await page.waitForTimeout(400); // Allow the wheel gesture to finish before sampling ticks.
      const transform = await viewport.getAttribute('style');
      await page.waitForTimeout(600);
      await expect(viewport).toHaveAttribute('style', transform!);
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
        await expect(page.getByLabel('Node details', { exact: true }).getByLabel('Node attribute value')).toHaveValue(
          '{object}'
        );
        await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
        await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(page.locator('.bt-native-node.status-running').first()).toBeVisible();
        await expect(page.getByTestId('bt-runtime-state')).toContainText('completed: success', { timeout: 40000 });
        // Execution never replaces the collapsed definition or enters a subtree.
        await expect(page.locator('.bt-native-node').filter({ hasText: 'Grasp detected object' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Parent tree', exact: true })).toHaveCount(0);
        const pick = page.locator('.bt-native-node').filter({ hasText: 'Pick detected object' });
        await expect(pick).toHaveClass(/status-success/);
        await pick.dblclick();
        await expect(page.locator('.bt-native-node').filter({ hasText: 'Grasp detected object' })).toHaveClass(
          /status-success/
        );
        await page.getByRole('button', { name: 'Parent tree', exact: true }).click();
        await expect(page.getByRole('log')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`${runtime}-${variant}.png`) });
        await menuAction(page, 'XML source');
        await expect(page.getByLabel('Tree XML')).toHaveValue(source);
      });
    }
  }
});
