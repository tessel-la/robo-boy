import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.locator('.workspace-opening')).toHaveCount(0);
}

for (const [viewport, width] of [['desktop', 1280], ['mobile', 390]] as const) {
  test(`preserves a cleared ${viewport} workspace through reconnect and reload`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installRosMock(page, { topics: [{ name: '/camera/image_raw', type: 'sensor_msgs/Image' }] });
    await page.goto('/');
    await connect(page);
    await expect(page.getByText('Add panel', { exact: true })).toBeVisible();
    await expect(page.locator('.workspace-card')).toHaveCount(0);

    for (const name of ['Camera', 'Pad controls']) {
      await page.getByLabel('Add workspace panel').first().click();
      await page.getByRole('button', { name, exact: true }).click();
    }
    await expect(page.locator('.workspace-card')).toHaveCount(2);

    // A populated workspace must still restore normally for the same connection.
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('.entry-section')).toBeVisible();
    await connect(page);
    await expect(page.locator('.workspace-card')).toHaveCount(2);

    await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Pad controls', exact: true }).click();
    await expect(page.locator('.workspace-card')).toHaveCount(0);
    await expect(page.getByText('Add panel', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('.entry-section')).toBeVisible();
    await connect(page);
    await expect(page.locator('.workspace-card')).toHaveCount(0);
    await expect(page.getByText('Add panel', { exact: true })).toBeVisible();

    await page.reload();
    await connect(page);
    await expect(page.locator('.workspace-card')).toHaveCount(0);
    await expect(page.getByText('Add panel', { exact: true })).toBeVisible();
  });
}
