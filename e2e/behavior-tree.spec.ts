import { test, expect, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

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

test.describe('Behavior Tree panel', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await connectWithMockRos(page);
  });

  test('renders toolbar, canvas, menu, and palette with mocked ROS discovery', async ({ page }) => {
    await openBehaviorTree(page);

    await expect(page.getByTestId('bt-menu-button')).toBeVisible();
    await expect(page.getByTestId('bt-palette-toggle')).toBeVisible();
    await expect(page.getByTestId('bt-node-palette')).toBeVisible();
    await expect(page.getByText('Node Palette')).toBeVisible();
    await expect(page.getByText('Control Flow')).toBeVisible();

    await page.getByTestId('bt-menu-button').click();
    await expect(page.getByTestId('bt-menu-panel')).toBeVisible();
    await expect(page.getByText('Saved Trees', { exact: true })).toBeVisible();
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

  test('keeps loaded nodes when adding another node after load', async ({ page }) => {
    await openBehaviorTree(page);

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
    await page.keyboard.down('Control');
    await selector.click();
    await page.keyboard.up('Control');

    await expect(page.getByTestId('bt-duplicate-selected')).toBeVisible();
    await page.getByTestId('bt-duplicate-selected').click();

    await expect(page.locator('.react-flow__node').filter({ hasText: 'Sequence' })).toHaveCount(2);
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Selector' })).toHaveCount(2);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
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
