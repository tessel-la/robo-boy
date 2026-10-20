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
    await expect(form.getByRole('radio')).toHaveCount(0);
    await expect(form.getByText('Domain ID')).toHaveCount(0);
    const host = page.getByRole('textbox', { name: 'Host or IP:' });
    const ports = page.locator('.connection-ports');
    const portToggle = ports.locator('summary');
    const rosPort = page.getByRole('textbox', { name: 'ROS', exact: true });
    await expect(rosPort).toBeHidden();
    await host.fill('alpha.local');
    await host.press('Tab');
    await expect(portToggle).toBeFocused();
    await portToggle.press('Enter');
    await expect(rosPort).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
    expect(await portToggle.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await rosPort.fill('19090');
    await page.screenshot({ path: `/tmp/roboboy-connections-${browserName}-${width}-ports.png` });
    await portToggle.click();
    await expect(rosPort).toBeHidden();
    await portToggle.press('Tab');
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeFocused();
    await portToggle.click();
    await expect(rosPort).toHaveValue('19090');
    await portToggle.click();
    await host.press('Enter');
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.locator('.workspace-opening')).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Add connection', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Switch connections, current/ }).click();
    await page.getByRole('button', { name: 'Open another connection', exact: true }).click();
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
    // Custom ports survive collapsing the menu and switching workspaces.
    await expect(page.getByRole('button', { name: /Switch connections, current: alpha.local/ })).toHaveAccessibleName(/19090/);
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
  await page.getByRole('button', { name: /Switch connections, current/ }).click();
  await expect(page.getByRole('button', { name: 'Open another connection', exact: true })).toBeVisible();
});
