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
});
