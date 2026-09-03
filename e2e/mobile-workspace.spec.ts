import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

async function addPanel(page: Page, name: string) {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('uses the unified empty multiview workspace on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page, { topics: [{ name: '/camera/image_raw', type: 'sensor_msgs/Image' }] });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(page.getByLabel('Desktop workspace')).toBeVisible();
  await expect(page.getByText('Add panel')).toBeVisible();
  await expect(page.locator('.workspace-card')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await addPanel(page, 'TF tree');
  await expect(page.getByTestId('tf-tree-panel')).toBeVisible();
  await addPanel(page, 'Behavior tree');
  await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();
  await expect(page.locator('.workspace-card')).toHaveCount(2);

  const cards = page.locator('.workspace-card');
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first && second && second.y > first.y).toBe(true);

  await page.getByLabel('Replace TF tree').click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page.locator('.workspace-card .camera-view')).toBeVisible();
  await expect(page.getByTestId('tf-tree-panel')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
