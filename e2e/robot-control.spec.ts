import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('a new session starts as an observer and can explicitly acquire and release control', async ({ page }) => {
  await installRosMock(page, { controlMode: 'observer' });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  const control = page.locator('.robot-control');
  await expect(control.locator('summary')).toHaveText('Read-only');
  await control.locator('summary').click();
  await expect(control.getByText('Read-only · Control available')).toBeVisible();
  await control.getByLabel('Session name').fill('Alice');
  await control.getByRole('button', { name: 'Set name' }).click();
  await control.getByRole('button', { name: 'Request control' }).click();
  await expect(control.locator('summary')).toHaveText('Control: you');
  await expect(control.getByText('You have control')).toBeVisible();
  await control.getByRole('button', { name: 'Release control', exact: true }).click();
  await expect(control.locator('summary')).toHaveText('Read-only');
  await expect(control.getByRole('button', { name: 'Request control' })).toBeEnabled();
});
