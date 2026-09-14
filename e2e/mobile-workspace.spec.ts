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
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-top', '44px');
    document.documentElement.style.setProperty('--safe-area-bottom', '34px');
    // Standalone iOS can report a shorter dynamic viewport than the fixed window. The shell must
    // stay anchored to both viewport edges instead of inheriting that shorter explicit height.
    document.documentElement.style.setProperty('--app-height', '754px');
  });

  const shellGeometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.App')!.getBoundingClientRect();
    const topBar = document.querySelector<HTMLElement>('.top-bar')!.getBoundingClientRect();
    const content = document.querySelector<HTMLElement>('.main-content-area')!.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      app: { top: app.top, bottom: app.bottom, height: app.height },
      topBar: { top: topBar.top, bottom: topBar.bottom, height: topBar.height },
      contentTop: content.top,
      contentBottom: content.bottom,
      documentHeight: document.documentElement.scrollHeight,
    };
  });

  expect(shellGeometry.app).toEqual({ top: 0, bottom: 844, height: 844 });
  expect(shellGeometry.topBar).toEqual({ top: 0, bottom: 84, height: 84 });
  expect(shellGeometry.contentTop).toBe(84);
  // Only the top bar spends an inset, to clear the clock it is drawn under. Nothing reserves a
  // strip at the bottom: the content area runs to the last pixel the viewport offers, so no band
  // of bare page background is left below the workspace.
  expect(shellGeometry.contentBottom).toBe(844);
  expect(shellGeometry.documentHeight).toBe(shellGeometry.viewportHeight);
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
