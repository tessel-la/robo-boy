import { expect, test } from '@playwright/test';

import { installRosMock } from './helpers/rosMock';

test('uses persistent single and split panels in the mobile view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await installRosMock(page, {
    topics: [{ name: '/camera/image_raw', type: 'sensor_msgs/Image' }],
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await expect(page.getByLabel('Mobile panels')).toBeVisible();
  await expect(page.locator('.mobile-workspace-window')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const splitButton = await page.getByLabel('Split mobile view').boundingBox();
  expect(splitButton).not.toBeNull();
  expect(Math.abs((splitButton!.x + splitButton!.width / 2) - 160)).toBeLessThanOrEqual(1);

  await page.getByLabel('Switch to TF Tree').click();
  await expect(page.getByTestId('tf-tree-panel')).toBeVisible();
  await page.getByLabel('Pause live TF updates').click();
  await page.getByLabel('Switch to Camera View').click();
  await expect(page.locator('.mobile-workspace-window .camera-view:visible')).toBeVisible();
  await page.getByLabel('Switch to TF Tree').click();
  await expect(page.getByLabel('Resume live TF updates')).toBeVisible();

  await page.getByLabel('Split mobile view').click();
  await expect(page.locator('.mobile-workspace-window')).toHaveCount(2);
  const panelHeader = await page.locator('.mobile-workspace-window-header').first().boundingBox();
  expect(panelHeader).not.toBeNull();
  expect(panelHeader!.height).toBeLessThanOrEqual(34);
  await page.getByLabel('Select bottom window').click();
  await page.getByLabel('Switch to Camera View').click();
  await expect(page.locator('.mobile-workspace-window .camera-view:visible')).toBeVisible();

  await page.getByLabel('Swap mobile windows').click();
  await expect(page.getByLabel('Select top window')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Switch to Camera View')).toHaveClass(/active/);

  await page.reload();
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.mobile-workspace-window')).toHaveCount(2);
  await expect(page.getByLabel('Switch to Camera View')).toHaveClass(/active/);
});
