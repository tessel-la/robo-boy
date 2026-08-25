import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('discovers and lazily loads the standalone Hello Panel artifact', async ({ page }) => {
  let panelBundleRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/panels/hello-panel/index.js')) panelBundleRequests += 1;
  });

  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Add workspace panel').first().click();
  await expect(page.getByRole('button', { name: 'Hello Panel', exact: true })).toBeVisible();
  expect(panelBundleRequests).toBe(0);

  await page.getByRole('button', { name: 'Hello Panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hello from outside Robo-Boy' })).toBeVisible();
  expect(panelBundleRequests).toBe(1);

  await page.getByRole('button', { name: 'Send greeting (0)' }).click();
  await expect(page.getByRole('button', { name: 'Send greeting (1)' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panels = JSON.parse(localStorage.getItem('robo-boy-desktop-workspace-panels-v1') || '[]');
        return panels[0]?.panelState?.greetings;
      })
    )
    .toBe(1);
});
