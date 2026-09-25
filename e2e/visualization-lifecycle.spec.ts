import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('repeated 3D panel creation, resize and removal keeps the tab responsive', async ({ page }) => {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (let cycle = 0; cycle < 20; cycle += 1) {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: '3D panel', exact: true }).click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await page.setViewportSize({ width: cycle % 2 ? 1280 : 960, height: 800 });
    await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
