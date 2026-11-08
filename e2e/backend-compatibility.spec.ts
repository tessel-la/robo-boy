import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installRosMock } from './helpers/rosMock';

const { version: appVersion } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Opt in against a disposable ROS stack. No commands or ownership requests are sent.
for (const runtime of ['web', 'desktop'] as const) {
  test(`reports the installed backend through a real ${runtime} connection`, async ({ page }, testInfo) => {
    const port = process.env.ROBOBOY_TEST_BACKEND_PORT;
    test.skip(!port, 'Set ROBOBOY_TEST_BACKEND_PORT to an isolated ROS stack gateway port.');
    if (runtime === 'desktop') {
      await page.addInitScript(() => {
        (window as unknown as { roboBoyDesktop: unknown }).roboBoyDesktop = { shell: 'electron' };
      });
    }
    await page.goto('/');
    if (runtime === 'web') await page.getByRole('button', { name: /Choose another robot/ }).click();
    // A different hostname exercises the web direct-host path as well as desktop.
    await page.getByRole('textbox', { name: 'Host or IP:' }).fill('localhost');
    await page.locator('.connection-ports summary').click();
    await page.getByRole('textbox', { name: 'ROS', exact: true }).fill(port!);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    const control = page.locator('.robot-control');
    await expect(control.locator('summary')).toHaveText('Read-only');
    await control.locator('summary').click();
    const info = control.getByRole('region', { name: 'Backend compatibility' });
    await expect(info.getByRole('status')).toHaveText('App and ROS stack versions match');
    await expect(info.locator('dd').nth(1)).toHaveText(appVersion);
    await expect(info.locator('dd').nth(2)).toHaveText(process.env.ROBOBOY_TEST_ROS_DISTRO ?? 'jazzy');
    await expect(info.locator('dd').nth(3)).toHaveText(/^\d+\.\d+\.\d+/);
    await expect(control.getByRole('button', { name: 'Request control', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`backend-${runtime}.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connect your robots' })).toBeVisible();
  });
}

for (const width of [320, 1280]) {
  for (const scenario of ['matched', 'mismatch', 'legacy'] as const) {
    test(`reports ${scenario} backend compatibility at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await installRosMock(page, {
        controlMode: 'observer',
        backend: scenario === 'legacy' ? null : {
          stackVersion: scenario === 'matched' ? appVersion : '0.1.0-alpha',
          rosDistro: 'jazzy', rosbridgeVersion: '2.3.0',
        },
      });
      await page.goto('/');
      await page.getByRole('button', { name: /Quick Connect/ }).click();
      await expect(page.getByLabel('Status: Connected')).toBeVisible();
      const control = page.locator('.robot-control');
      const summary = control.locator('summary');
      await expect(summary).toHaveText('Read-only');
      await expect(summary.locator('.robot-control-version-warning')).toHaveCount(scenario === 'matched' ? 0 : 1);
      await summary.click();
      const info = control.getByRole('region', { name: 'Backend compatibility' });
      await expect(info.getByRole('status')).toHaveText(scenario === 'matched' ? 'App and ROS stack versions match' :
        scenario === 'mismatch' ? 'App and ROS stack versions differ' : 'Backend version unverified');
      await expect(info.locator('dd').nth(0)).toHaveText(appVersion);
      await expect(info.locator('dd').nth(1)).toHaveText(scenario === 'legacy' ? 'Not reported' : scenario === 'matched' ? appVersion : '0.1.0-alpha');
      await expect(info.locator('dd').nth(2)).toHaveText(scenario === 'legacy' ? 'Not reported' : 'jazzy');
      await expect(info.locator('dd').nth(3)).toHaveText(scenario === 'legacy' ? 'Not reported' : '2.3.0');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('backend-versions.png') });
      // The warning is advisory; the existing gateway still owns authorization.
      await control.getByRole('button', { name: 'Request control', exact: true }).click();
      await expect(summary).toHaveText('Control: you');
      await page.keyboard.press('Escape');
      await expect(summary).toBeFocused();
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Connect your robots' })).toBeVisible();
    });
  }
}
