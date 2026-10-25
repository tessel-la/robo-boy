import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('keeps axes length and width independent and restores them with the new label defaults', async ({ page }) => {
  await installRosMock(page);
  await page.goto('/');
  const connect = async () => {
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
  };
  await connect();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  const openFrameDisplay = async () => {
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByRole('button', { name: 'Frame display settings', exact: true }).click();
  };
  await openFrameDisplay();
  const length = panel.getByLabel('Axes length in metres');
  const width = panel.getByLabel('Axes width in metres');
  await expect(length).toHaveValue('0.10');
  await expect(width).toHaveValue('0.003');
  await expect(panel.getByLabel('Label size in metres')).toHaveValue('0.35');
  await expect(panel.getByLabel('Label opacity', { exact: true })).toHaveValue('0.8');
  await expect(panel.getByLabel('Label background')).not.toBeChecked();

  await width.fill('0.007');
  await width.press('Enter');
  await expect(length).toHaveValue('0.10');
  await length.fill('0.20');
  await length.press('Enter');
  await expect(width).toHaveValue('0.007');
  await page.reload();
  await connect();
  await openFrameDisplay();
  await expect(length).toHaveValue('0.20');
  await expect(width).toHaveValue('0.007');
  await expect(panel.getByLabel('Label background')).not.toBeChecked();
  await expect(panel.getByLabel('Label opacity', { exact: true })).toHaveValue('0.8');
});
