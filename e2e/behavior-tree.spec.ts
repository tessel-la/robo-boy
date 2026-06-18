import { test, expect, type Locator, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { installRosMock } from './helpers/rosMock';

const MULTI_SELECT_MODIFIER = (process.platform === 'darwin' ? 'Meta' : 'Control') as
  | 'Meta'
  | 'Control';

async function connectWithMockRos(page: Page) {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await expect(page.locator('#ros2Value')).toBeVisible();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}

async function openBehaviorTree(page: Page) {
  await page.getByLabel('Switch to Behavior Tree').click();
  await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();
  await expect(page.getByTestId('bt-canvas')).toBeVisible();
}

async function openNodePalette(page: Page) {
  const palette = page.getByTestId('bt-node-palette');
  if ((await palette.count()) > 0 && (await palette.first().isVisible())) {
    return;
  }

  const toggle = page.getByTestId('bt-palette-toggle');
  const isActive = await toggle.evaluate((element) => element.classList.contains('active'));

  if (isActive) {
    await toggle.click();
    await expect(palette).toHaveCount(0);
  }

  await toggle.click();
  await expect(palette).toBeVisible();
}

async function closeNodePalette(page: Page) {
  const palette = page.getByTestId('bt-node-palette');
  if ((await palette.count()) === 0 || !(await palette.first().isVisible())) {
    return;
  }

  await page.getByTestId('bt-palette-toggle').click();
  await expect(palette).toHaveCount(0);
}

async function multiSelectClick(locator: Locator) {
  await locator.click({ modifiers: [MULTI_SELECT_MODIFIER] });
}

async function seedSavedTree(page: Page) {
  await page.evaluate(() => {
    const now = Date.now();
    const tree = {
      id: 'e2e-duplicate-source',
      name: 'Duplicate Source',
      nodes: [
        {
          id: 'node-0',
          type: 'sequence',
          position: { x: 0, y: 0 },
          data: { label: 'Sequence', type: 'sequence' },
        },
        {
          id: 'node-1',
          type: 'selector',
          position: { x: 0, y: 140 },
          data: { label: 'Selector', type: 'selector' },
        },
      ],
      edges: [
        {
          id: 'edge-0',
          source: 'node-0',
          target: 'node-1',
          sourceHandle: null,
          targetHandle: null,
          animated: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([{ tree, version: '1.0.0' }])
    );
  });
}

async function seedRunningActionTree(page: Page) {
  await page.evaluate(() => {
    const now = Date.now();
    const tree = {
      id: 'e2e-running-action',
      name: 'Long Action Tree',
      nodes: [
        {
          id: 'node-0',
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            label: 'Navigate',
            actionName: '/navigate_to_pose',
            actionType: 'nav2_msgs/action/NavigateToPose',
            parameters: {},
            timeout: 60000,
          },
        },
      ],
      edges: [],
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([{ tree, version: '1.0.0' }])
    );
  });
}

async function seedOrderedSequenceTree(page: Page) {
  await page.evaluate(() => {
    const now = Date.now();
    const tree = {
      id: 'e2e-ordered-sequence',
      name: 'Ordered Sequence',
      nodes: [
        {
          id: 'node-0',
          type: 'sequence',
          position: { x: 260, y: 260 },
          data: { label: 'Sequence', type: 'sequence' },
        },
        {
          id: 'node-1',
          type: 'action',
          position: { x: 220, y: -120 },
          data: {
            label: 'First Action',
            actionName: '/first_action',
            actionType: 'example_msgs/action/First',
            parameters: {},
          },
        },
        {
          id: 'node-2',
          type: 'action',
          position: { x: -220, y: 100 },
          data: {
            label: 'Second Action',
            actionName: '/second_action',
            actionType: 'example_msgs/action/Second',
            parameters: {},
          },
        },
      ],
      edges: [
        { id: 'edge-0', source: 'node-0', target: 'node-1', animated: true },
        { id: 'edge-1', source: 'node-0', target: 'node-2', animated: true },
      ],
      createdAt: now,
      updatedAt: now,
    };

    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([{ tree, version: '1.0.0' }])
    );
  });
}

async function importTreeFromMenu(page: Page, tree: Record<string, unknown>) {
  await page.getByTestId('bt-menu-button').click();
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'imported-tree.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ tree, version: '1.0.0' })),
  });
}

test.describe('Behavior Tree panel', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await connectWithMockRos(page);
  });

  test('renders toolbar, canvas, menu, and palette with mocked ROS discovery', async ({ page }) => {
    await openBehaviorTree(page);

    await expect(page.getByTestId('bt-menu-button')).toBeVisible();
    await expect(page.getByTestId('bt-palette-toggle')).toBeVisible();
    await expect(page.getByTestId('bt-select-mode')).toBeVisible();
    await expect(page.getByTestId('bt-pan-mode')).toBeVisible();
    await expect(page.getByTestId('bt-follow-mode')).toBeVisible();
    await expect(page.getByTestId('bt-redo')).toBeDisabled();
    await expect(page.getByTestId('bt-pan-mode')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bt-follow-mode')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('bt-select-mode').click();
    await expect(page.getByTestId('bt-select-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bt-pan-mode').click();
    await expect(page.getByTestId('bt-pan-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bt-follow-mode').click();
    await expect(page.getByTestId('bt-follow-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('bt-follow-mode').click();
    await expect(page.getByTestId('bt-follow-mode')).toHaveAttribute('aria-pressed', 'false');

    await openNodePalette(page);
    await expect(page.getByTestId('bt-node-palette')).toBeVisible();
    await expect(page.getByText('Node Palette')).toBeVisible();
    await expect(page.getByText('Control Flow')).toBeVisible();

    const resourceSearch = page.getByRole('searchbox', { name: 'Search available ROS resources' });
    await expect(resourceSearch).toBeVisible();
    await resourceSearch.fill('NavigateToPose');
    await expect(page.getByText('/navigate_to_pose', { exact: true })).toBeVisible();
    await resourceSearch.fill('SetBool');
    await expect(page.getByText('/set_bool', { exact: true })).toBeVisible();
    await expect(page.getByText('/navigate_to_pose', { exact: true })).toHaveCount(0);
    await resourceSearch.fill('Twist');
    await expect(page.getByText('/cmd_vel', { exact: true })).toBeVisible();
    await resourceSearch.fill('missing resource');
    await expect(page.getByText('No matching actions, services, or topics')).toBeVisible();

    await page.getByTestId('bt-menu-button').click();
    await expect(page.getByTestId('bt-menu-panel')).toBeVisible();
    await expect(page.getByTestId('bt-menu-panel').getByText('Saved Trees', { exact: true })).toBeVisible();
  });

  test('renames and saves a tree into localStorage', async ({ page }) => {
    await openBehaviorTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-name-input').fill('Inspection Tree');
    await page.keyboard.press('Enter');
    await expect(page.locator('.bt-float-name')).toHaveText('Inspection Tree');

    await page.getByRole('button', { name: 'Save' }).click();

    const savedTreeNames = await page.evaluate(() => {
      const stored = localStorage.getItem('robo-boy-behavior-trees');
      if (!stored) return [];
      return JSON.parse(stored).map((item: { tree: { name: string } }) => item.tree.name);
    });
    expect(savedTreeNames).toContain('Inspection Tree');
  });

  test('searches loaded nodes by ROS name and focuses the result', async ({ page }) => {
    await openBehaviorTree(page);
    await seedRunningActionTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Long Action Tree' }).click();

    const search = page.getByRole('combobox', { name: 'Search tree nodes' });
    await search.fill('navigate_to_pose');
    await page.getByRole('option', { name: /Navigate/ }).click();

    await expect(search).toHaveValue('Navigate');
    await expect(page.locator('.bt-node.selected').filter({ hasText: 'Navigate' })).toHaveCount(1);
  });

  test('uses the mobile bottom sheet to tap-add a Sequence node', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBehaviorTree(page);

    await expect(page.getByTestId('bt-node-palette')).toHaveCount(0);

    await page.getByTestId('bt-palette-toggle').click();
    await expect(page.getByTestId('bt-node-palette')).toBeVisible();
    await expect(page.getByTestId('bt-node-palette')).toHaveClass(/mobile-sheet/);

    await page.getByTestId('bt-node-palette').getByText('Sequence').click();

    await expect(page.getByTestId('bt-node-palette')).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);
  });

  test('defaults an action node name and lets the user rename it', async ({ page }) => {
    await openBehaviorTree(page);
    await openNodePalette(page);

    await page.getByText('ROS Actions', { exact: true }).click();
    await page.getByTestId('bt-node-palette').getByTitle('/navigate_to_pose').click();

    const actionNode = page.locator('.react-flow__node').filter({ hasText: '/navigate_to_pose' });
    await expect(actionNode).toHaveCount(1);
    await actionNode.click();

    await page.getByTestId('bt-rename-selected').click();
    const dialog = page.getByRole('dialog', { name: 'Name node' });
    await expect(dialog.getByLabel('Node name')).toHaveValue('/navigate_to_pose');
    await dialog.getByLabel('Node name').fill('Navigate home');
    await dialog.getByRole('button', { name: 'Save name' }).click();

    await expect(actionNode).toContainText('Navigate home');
    await expect(actionNode).toContainText('/navigate_to_pose');

    await page.getByTestId('bt-menu-button').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    const savedAction = await page.evaluate(() => {
      const stored = localStorage.getItem('robo-boy-behavior-trees');
      if (!stored) return null;
      return JSON.parse(stored)[0]?.tree.nodes[0]?.data ?? null;
    });
    expect(savedAction).toMatchObject({
      label: 'Navigate home',
      actionName: '/navigate_to_pose',
    });
  });

  test('keeps loaded nodes when adding another node after load', async ({ page }) => {
    await openBehaviorTree(page);

    await openNodePalette(page);
    await page.getByTestId('bt-node-palette').getByText('Sequence').click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-name-input').fill('Collision Tree');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'New' }).click();

    await expect(page.locator('.react-flow__node')).toHaveCount(0);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Collision Tree' }).click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    await openNodePalette(page);
    await page.getByTestId('bt-node-palette').getByText('Selector').click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Selector' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
  });

  test('duplicates selected nodes and their internal edge', async ({ page }) => {
    await openBehaviorTree(page);
    await seedSavedTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Duplicate Source' }).click();

    const sequence = page.locator('.react-flow__node').filter({ hasText: 'Sequence' });
    const selector = page.locator('.react-flow__node').filter({ hasText: 'Selector' });
    await expect(sequence).toHaveCount(1);
    await expect(selector).toHaveCount(1);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    await sequence.click();
    await multiSelectClick(selector);

    await expect(page.getByTestId('bt-duplicate-selected')).toBeVisible();
    await page.getByTestId('bt-duplicate-selected').click();

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(2);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Selector' })).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  });

  test('highlights all ctrl-selected nodes and clears them with one pane click', async ({ page }) => {
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    const firstAction = page.locator('.react-flow__node').filter({ hasText: 'First Action' });
    const secondAction = page.locator('.react-flow__node').filter({ hasText: 'Second Action' });

    await firstAction.click();
    await multiSelectClick(secondAction);

    await expect(page.locator('.bt-node.clicked')).toHaveCount(2);
    await expect(firstAction.locator('.bt-node')).toHaveClass(/clicked/);
    await expect(secondAction.locator('.bt-node')).toHaveClass(/clicked/);

    await page.getByTestId('bt-canvas').click({ position: { x: 24, y: 24 } });

    await expect(page.locator('.bt-node.clicked')).toHaveCount(0);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  });

  test('box-select stays active while dragging across nodes', async ({ page }) => {
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    const firstAction = page.locator('.react-flow__node').filter({ hasText: 'First Action' });
    const secondAction = page.locator('.react-flow__node').filter({ hasText: 'Second Action' });
    const firstBox = await firstAction.boundingBox();
    const secondBox = await secondAction.boundingBox();
    const canvasBox = await page.getByTestId('bt-canvas').boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();

    const startX = Math.max((canvasBox?.x ?? 0) + 72, Math.min(firstBox?.x ?? 0, secondBox?.x ?? 0) - 36);
    const startY = Math.max((canvasBox?.y ?? 0) + 72, Math.min(firstBox?.y ?? 0, secondBox?.y ?? 0) - 36);
    const firstCenterX = (firstBox?.x ?? 0) + (firstBox?.width ?? 0) / 2;
    const firstCenterY = (firstBox?.y ?? 0) + (firstBox?.height ?? 0) / 2;
    const endX = Math.max((firstBox?.x ?? 0) + (firstBox?.width ?? 0), (secondBox?.x ?? 0) + (secondBox?.width ?? 0)) + 36;
    const endY = Math.max((firstBox?.y ?? 0) + (firstBox?.height ?? 0), (secondBox?.y ?? 0) + (secondBox?.height ?? 0)) + 36;

    await page.getByTestId('bt-select-mode').click();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(firstCenterX, firstCenterY, { steps: 5 });
    await expect(firstAction.locator('.bt-node')).toHaveClass(/clicked/);
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('.bt-node.clicked')).toHaveCount(2);
    await expect(firstAction.locator('.bt-node')).toHaveClass(/clicked/);
    await expect(secondAction.locator('.bt-node')).toHaveClass(/clicked/);
    await expect(page.getByTestId('bt-selection-actions')).toBeVisible();
  });

  test('wraps and explodes from the contextual selection actions', async ({ page }) => {
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    const firstAction = page.locator('.react-flow__node').filter({ hasText: 'First Action' });
    const secondAction = page.locator('.react-flow__node').filter({ hasText: 'Second Action' });

    await firstAction.click();
    await multiSelectClick(secondAction);

    await expect(page.getByTestId('bt-selection-actions')).toBeVisible();
    await expect(page.getByTestId('bt-context-wrap')).toBeVisible();
    await page.getByTestId('bt-context-wrap').click();

    const subtreeNode = page.locator('.react-flow__node').filter({ hasText: 'Subtree' });
    await expect(subtreeNode).toHaveCount(1);
    await expect(page.getByTestId('bt-undo')).toBeEnabled();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'First Action' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Second Action' })).toHaveCount(1);
    await expect(page.getByTestId('bt-redo')).toBeEnabled();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(1);
    await expect(page.getByTestId('bt-redo')).toBeDisabled();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(0);

    await firstAction.click();
    await multiSelectClick(secondAction);
    await page.getByTestId('bt-context-wrap').click();

    await expect(subtreeNode).toHaveCount(1);
    await expect(page.getByTestId('bt-context-open-subtree')).toBeVisible();
    await expect(page.getByTestId('bt-context-save-subtree')).toBeVisible();
    await expect(page.getByTestId('bt-context-explode')).toBeVisible();
    await page.getByTestId('bt-context-explode').click();

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'First Action' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Second Action' })).toHaveCount(1);
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: '1' })).toHaveCount(1);
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: '2' })).toHaveCount(1);
  });

  test('undoes loading, creating, importing, and subtree-path changes safely', async ({ page }) => {
    await openBehaviorTree(page);
    await seedSavedTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Duplicate Source' }).click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.getByTestId('bt-redo')).toBeEnabled();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    await page.getByTestId('bt-menu-button').click();
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    const now = Date.now();
    await importTreeFromMenu(page, {
      id: 'e2e-imported-tree',
      name: 'Imported Tree',
      nodes: [
        {
          id: 'node-imported',
          type: 'action',
          position: { x: 0, y: 0 },
          data: {
            label: 'Imported Action',
            actionName: '/imported',
            actionType: 'example_msgs/action/Imported',
          },
        },
      ],
      edges: [],
      createdAt: now,
      updatedAt: now,
    });
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Imported Action' })).toHaveCount(1);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);

    await page.locator('.react-flow__node').filter({ hasText: 'Sequence' }).click();
    await multiSelectClick(page.locator('.react-flow__node').filter({ hasText: 'Selector' }));
    await page.getByTestId('bt-context-wrap').click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(1);
    await page.getByTestId('bt-context-open-subtree').click();
    await expect(page.getByTestId('bt-subtree-parent')).toBeVisible();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(page.getByTestId('bt-subtree-parent')).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(1);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Selector' })).toHaveCount(1);
  });

  test('opens a saved tree as root when selected from inside a subtree', async ({ page }) => {
    await openBehaviorTree(page);
    await page.evaluate(() => {
      const now = Date.now();
      const subtreeSource = {
        id: 'e2e-subtree-load-source',
        name: 'Subtree Load Source',
        nodes: [
          {
            id: 'node-a',
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              label: 'Source A',
              actionName: '/source_a',
              actionType: 'example_msgs/action/SourceA',
              parameters: {},
            },
          },
          {
            id: 'node-b',
            type: 'action',
            position: { x: 260, y: 0 },
            data: {
              label: 'Source B',
              actionName: '/source_b',
              actionType: 'example_msgs/action/SourceB',
              parameters: {},
            },
          },
        ],
        edges: [],
        createdAt: now,
        updatedAt: now,
      };
      const freshRoot = {
        id: 'e2e-fresh-root-tree',
        name: 'Fresh Root Tree',
        nodes: [
          {
            id: 'node-root',
            type: 'action',
            position: { x: 0, y: 0 },
            data: {
              label: 'Fresh Root Action',
              actionName: '/fresh_root',
              actionType: 'example_msgs/action/FreshRoot',
              parameters: {},
            },
          },
        ],
        edges: [],
        createdAt: now,
        updatedAt: now,
      };

      localStorage.setItem(
        'robo-boy-behavior-trees',
        JSON.stringify([
          { tree: subtreeSource, version: '1.0.0' },
          { tree: freshRoot, version: '1.0.0' },
        ])
      );
    });

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Subtree Load Source' }).click();

    const sourceA = page.locator('.react-flow__node').filter({ hasText: 'Source A' });
    const sourceB = page.locator('.react-flow__node').filter({ hasText: 'Source B' });
    await sourceA.click();
    await multiSelectClick(sourceB);
    await page.getByTestId('bt-context-wrap').click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Subtree' })).toHaveCount(1);
    await page.getByTestId('bt-context-open-subtree').click();
    await expect(page.getByTestId('bt-subtree-parent')).toBeVisible();

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Fresh Root Tree' }).click();

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Fresh Root Action' })).toHaveCount(1);
    await expect(page.getByTestId('bt-subtree-parent')).toHaveCount(0);
  });

  test('adds retry and repeat nodes and edits their iteration counts', async ({ page }) => {
    await openBehaviorTree(page);
    await openNodePalette(page);

    await page.getByTestId('bt-node-palette').getByText('Retry').click();
    await page.getByTestId('bt-node-palette').getByText('Repeat').click();
    await closeNodePalette(page);

    const retryNode = page.locator('.react-flow__node').filter({ hasText: 'Retry' });
    const repeatNode = page.locator('.react-flow__node').filter({ hasText: 'Repeat' });
    await expect(retryNode).toHaveCount(1);
    await expect(retryNode).toContainText('3 attempts');
    await expect(repeatNode).toHaveCount(1);
    await expect(repeatNode).toContainText('3 repeats');

    await retryNode.click();
    await page.getByTestId('bt-configure-iteration').click();
    await page.getByLabel('Attempts').fill('-1');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(retryNode).toContainText('Infinite');

    await repeatNode.click();
    await page.getByTestId('bt-configure-iteration').click();
    await page.getByLabel('Repeats').fill('5');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(repeatNode).toContainText('5 repeats');
  });

  test('selects a clicked connection without keeping stale node highlights', async ({ page }) => {
    await openBehaviorTree(page);
    await seedSavedTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Duplicate Source' }).click();

    const edge = page
      .locator('.react-flow__edge')
      .filter({ has: page.locator('.react-flow__edge-interaction') });
    const parent = page.locator('.react-flow__node').filter({ hasText: 'Sequence' });
    const child = page.locator('.react-flow__node').filter({ hasText: 'Selector' });

    await parent.click();
    const parentBox = await parent.boundingBox();
    const childBox = await child.boundingBox();
    expect(parentBox).not.toBeNull();
    expect(childBox).not.toBeNull();
    await page.mouse.click(
      (parentBox?.x ?? 0) + (parentBox?.width ?? 0) / 2,
      ((parentBox?.y ?? 0) + (parentBox?.height ?? 0) + (childBox?.y ?? 0)) / 2
    );

    await expect(edge).toHaveClass(/selected/);
    await expect(edge.locator('.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(255, 179, 0)');
    await expect(edge.locator('.react-flow__edge-path')).toHaveCSS('stroke-width', '5px');
    await expect(child).not.toHaveClass(/selected/);
    await expect(parent).not.toHaveClass(/selected/);
  });

  test('ctrl-selects multiple links without selecting nodes', async ({ page }) => {
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    const sequence = page.locator('.react-flow__node').filter({ hasText: 'Sequence' });
    const firstAction = page.locator('.react-flow__node').filter({ hasText: 'First Action' });
    const secondAction = page.locator('.react-flow__node').filter({ hasText: 'Second Action' });
    const sequenceBox = await sequence.boundingBox();
    const firstBox = await firstAction.boundingBox();
    const secondBox = await secondAction.boundingBox();

    expect(sequenceBox).not.toBeNull();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    await page.mouse.click(
      ((sequenceBox?.x ?? 0) + (sequenceBox?.width ?? 0) / 2 + (firstBox?.x ?? 0) + (firstBox?.width ?? 0) / 2) / 2,
      ((sequenceBox?.y ?? 0) + (sequenceBox?.height ?? 0) / 2 + (firstBox?.y ?? 0) + (firstBox?.height ?? 0) / 2) / 2
    );
    await page.keyboard.down('Control');
    await page.mouse.click(
      ((sequenceBox?.x ?? 0) + (sequenceBox?.width ?? 0) / 2 + (secondBox?.x ?? 0) + (secondBox?.width ?? 0) / 2) / 2,
      ((sequenceBox?.y ?? 0) + (sequenceBox?.height ?? 0) / 2 + (secondBox?.y ?? 0) + (secondBox?.height ?? 0) / 2) / 2
    );
    await page.keyboard.up('Control');

    await expect(page.locator('.react-flow__edge.selected')).toHaveCount(2);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
    await expect(page.locator('.bt-node.clicked')).toHaveCount(0);
  });

  test('stacks mobile toolbar groups vertically without overlap', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await openBehaviorTree(page);
    await seedSavedTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Duplicate Source' }).click();
    await page.locator('.react-flow__node').filter({ hasText: 'Sequence' }).click();

    const leftTools = page.locator('.bt-float-bar');
    const rightTools = page.locator('.bt-float-actions');
    const menuButton = page.getByTestId('bt-menu-button');
    const paletteButton = page.getByTestId('bt-palette-toggle');
    const arrangeButton = page.getByTestId('bt-arrange-tree');
    const selectionActions = page.getByTestId('bt-selection-actions');
    await expect(page.getByTestId('bt-rename-selected')).toBeVisible();
    await expect(page.getByTestId('bt-duplicate-selected')).toBeVisible();
    await expect(selectionActions).toBeVisible();

    const leftBox = await leftTools.boundingBox();
    const rightBox = await rightTools.boundingBox();
    const menuBox = await menuButton.boundingBox();
    const paletteBox = await paletteButton.boundingBox();
    const arrangeBox = await arrangeButton.boundingBox();

    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect((leftBox?.x ?? 0) + (leftBox?.width ?? 0)).toBeLessThanOrEqual(rightBox?.x ?? 0);
    expect(menuBox?.x).toBe(paletteBox?.x);
    expect(paletteBox?.x).toBe(arrangeBox?.x);
    expect(menuBox?.y ?? 0).toBeLessThan(paletteBox?.y ?? 0);
    expect(paletteBox?.y ?? 0).toBeLessThan(arrangeBox?.y ?? 0);
  });

  test('shows sequence child order and reorders children', async ({ page }) => {
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    await expect(page.locator('.react-flow__edge-text').filter({ hasText: '1' })).toHaveCount(1);
    await expect(page.locator('.react-flow__edge-text').filter({ hasText: '2' })).toHaveCount(1);

    const sequenceNode = page.locator('.react-flow__node').filter({ hasText: 'Sequence' });
    await sequenceNode.click();
    await expect(page.getByTestId('bt-child-order-panel')).toHaveCount(0);
    await sequenceNode.dblclick();
    const orderPanel = page.getByTestId('bt-child-order-panel');
    await expect(orderPanel).toBeVisible();
    await expect(orderPanel.getByTestId('bt-order-row')).toHaveCount(2);
    await expect(orderPanel.getByTestId('bt-order-row').nth(0)).toContainText('First Action');
    await expect(orderPanel.getByTestId('bt-order-row').nth(1)).toContainText('Second Action');

    await orderPanel.getByLabel('Move Second Action earlier').click();

    await expect(orderPanel.getByTestId('bt-order-row').nth(0)).toContainText('Second Action');
    await expect(orderPanel.getByTestId('bt-order-row').nth(1)).toContainText('First Action');
  });

  test('arranges a messy tree on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBehaviorTree(page);
    await seedOrderedSequenceTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Ordered Sequence' }).click();

    const sequence = page.locator('.react-flow__node').filter({ hasText: 'Sequence' });
    const firstAction = page.locator('.react-flow__node').filter({ hasText: 'First Action' });
    const secondAction = page.locator('.react-flow__node').filter({ hasText: 'Second Action' });
    const sequenceBefore = await sequence.boundingBox();
    const firstBefore = await firstAction.boundingBox();

    expect(sequenceBefore?.y).toBeGreaterThan(firstBefore?.y ?? 0);
    await page.getByRole('button', { name: 'Arrange tree' }).click();

    await expect.poll(async () => {
      const sequenceBox = await sequence.boundingBox();
      const firstBox = await firstAction.boundingBox();
      const secondBox = await secondAction.boundingBox();
      if (!sequenceBox || !firstBox || !secondBox) return false;

      return sequenceBox.y < firstBox.y && sequenceBox.y < secondBox.y && firstBox.x < secondBox.x;
    }).toBe(true);
  });

  test('opens action settings with a mobile double tap', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBehaviorTree(page);
    await seedRunningActionTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Long Action Tree' }).click();

    const actionNode = page.locator('.react-flow__node').filter({ hasText: 'Navigate' });
    await expect(actionNode).toHaveCount(1);

    await actionNode.click();
    await actionNode.click();

    await expect(page.locator('.ape-overlay')).toBeVisible();
  });

  test('keeps execution alive in 3D view and exposes top-bar controls', async ({ page }) => {
    await openBehaviorTree(page);
    await seedRunningActionTree(page);

    await page.getByTestId('bt-menu-button').click();
    await page.locator('.bt-menu-tree-row').filter({ hasText: 'Long Action Tree' }).click();
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Navigate' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.locator('.bt-node').filter({ hasText: 'Navigate' })).toHaveClass(/status-running/);

    await page.getByLabel('Switch to 3D View').click();
    const island = page.locator('.bt-execution-island');
    await expect(island).toBeVisible();
    await expect(island).toContainText('Long Action Tree');
    await expect(island).toContainText('Navigate');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(island.locator('.bt-execution-pulse')).toBeVisible();
    await expect(island.locator('.bt-execution-node')).toBeVisible();
    const mobileIslandBox = await island.boundingBox();
    const mobileReturnBox = await page.getByLabel('Open behavior tree').boundingBox();
    const mobileToggleBox = await page.locator('.view-toggle').boundingBox();
    expect(mobileIslandBox?.width).toBeGreaterThan(88);
    expect(mobileIslandBox?.width).toBeLessThan(160);
    expect(mobileReturnBox?.width).toBeGreaterThan(52);
    expect(mobileReturnBox?.width).toBeLessThan(122);
    expect(mobileToggleBox?.width).toBeLessThan(250);

    await page.getByLabel('Open behavior tree').click();
    await expect(page.getByTestId('behavior-tree-panel')).toHaveCount(1);
    await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();
    await expect(page.locator('.bt-node').filter({ hasText: 'Navigate' })).toHaveClass(/status-running/);

    await page.getByLabel('Switch to 3D View').click();
    await page.getByLabel('Stop behavior tree').click();
    await expect(island).toHaveCount(0);

    await page.getByLabel('Switch to Behavior Tree').click();
    await expect(page.getByTestId('behavior-tree-panel')).toHaveCount(1);
    await expect(page.locator('.bt-node').filter({ hasText: 'Navigate' })).not.toHaveClass(/status-running/);
  });
});
