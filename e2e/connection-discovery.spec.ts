import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

for (const width of [1280, 540, 390, 320]) {
  test(`discovers and switches multiple connections at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 844 });
    await installRosMock(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Connect your robots' })).toBeVisible();
    await expect(page.getByText('Each connection has its own workspace. Add more as you go.')).toBeVisible();
    const disclosure = page.getByTitle('Advanced Options');
    const form = page.locator('.advanced-form');
    await expect(disclosure).toHaveAccessibleName(/Choose another robot/);
    expect(await form.evaluate(element => (element as HTMLElement).inert)).toBe(true);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.entry-section')!).opacity) === 1);
    await page.screenshot({ path: `/tmp/roboboy-connections-${browserName}-${width}-landing.png` });

    // Opening again during the closing animation must leave the form interactive.
    await disclosure.click();
    await disclosure.click();
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => form.evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
    expect(await form.evaluate(element => (element as HTMLElement).inert)).toBe(false);
    await page.getByRole('textbox', { name: 'Host or IP:' }).fill('alpha.local');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.locator('.workspace-opening')).toHaveCount(0);

    const add = page.getByRole('button', { name: 'Add connection', exact: true });
    await expect(add).toBeVisible();
    const rect = await add.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    const panelAdd = await page.locator('.top-bar .workspace-add-control').boundingBox();
    expect(rect!.x + rect!.width + 4).toBeLessThanOrEqual(panelAdd!.x);
    await add.click();
    await disclosure.click();
    await page.getByRole('textbox', { name: 'Host or IP:' }).fill('beta.local');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.locator('.workspace-opening')).toHaveCount(0);
    await expect(page.getByTitle('2 open connections')).toBeAttached();
    await page.getByRole('button', { name: /Switch connections, current/ }).click();
    await expect(page.locator('.connection-switcher-heading')).toContainText('2');
    await page
      .getByRole('dialog', { name: 'Switch robot connection' })
      .getByRole('button', { name: /alpha.local.*Connected/ })
      .click();
    await expect(page.getByRole('button', { name: /Switch connections, current: alpha.local/ })).toBeVisible();
    await expect(page.getByTitle('2 open connections')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/roboboy-connections-${browserName}-${width}-workspace.png` });
  });
}

test('reduced motion keeps quick connect and the labelled disclosure usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installRosMock(page);
  await page.goto('/');
  await expect(page.locator('.entry-section')).toHaveCSS('opacity', '1');
  await expect(page.locator('.logo-container')).toHaveCSS('transform', 'none');
  await page.getByRole('button', { name: /Choose another robot/ }).click();
  await expect(page.getByRole('textbox', { name: 'Host or IP:' })).toBeVisible();
  await expect(page.locator('.connection-disclosure-icon')).toHaveCSS('transition-duration', '0s');
  await page.getByRole('button', { name: /Quick Connect/ }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.locator('.workspace-opening')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toBeVisible();
});
