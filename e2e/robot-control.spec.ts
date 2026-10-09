import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('shared control has no ownership buttons or client configuration', async ({ page }) => {
  await installRosMock(page, { controlMode: 'shared' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  const control = page.locator('.robot-control');
  await expect(control.locator('summary')).toHaveText('Shared control');
  await control.locator('summary').click();
  await expect(control.getByText('Shared control · Connected sessions can send commands')).toBeVisible();
  await expect(control.getByRole('button', { name: 'Request control' })).toHaveCount(0);
  await expect(control.getByRole('button', { name: 'Release control' })).toHaveCount(0);
  await expect(control.getByRole('spinbutton')).toHaveCount(0);
  await expect(control.getByRole('checkbox')).toHaveCount(0);
});

test('indefinite idle control still requires explicit acquisition', async ({ page }) => {
  await installRosMock(page, { controlMode: 'observer', idleSeconds: 0 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  const control = page.locator('.robot-control');
  await expect(control.locator('summary')).toHaveText('Read-only');
  await control.locator('summary').click();
  await expect(control.getByText(/Control has no idle timeout/)).toBeVisible();
  await control.getByRole('button', { name: 'Request control' }).click();
  await expect(control.locator('summary')).toHaveText('Control: you');
});

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
  await control.getByLabel('Session name').press('Enter');
  await expect(control.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
  await expect(control.getByText('Name saved as Alice.', { exact: true })).toBeVisible();
  await control.getByRole('button', { name: 'Request control' }).click();
  await expect(control.locator('summary')).toHaveText('Control: you');
  await expect(control.getByText('You have control')).toBeVisible();
  await control.getByRole('button', { name: 'Release control', exact: true }).click();
  await expect(control.locator('summary')).toHaveText('Read-only');
  await expect(control.getByRole('button', { name: 'Request control' })).toBeEnabled();
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 390 },
  { width: 1280, height: 860 },
]) {
  test(`control and Add Panel remain reachable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await installRosMock(page, { controlMode: 'observer' });
    await page.addInitScript(width => {
      localStorage.setItem('appTheme', width === 390 ? 'light' : width === 768 ? 'solarized' : 'dark');
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'control-layout', type: 'tfTree', title: 'TF tree' }])
      );
    }, viewport.width);
    await page.goto('/');
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.locator('.workspace-card')).toHaveCount(1);
    await expect(page.locator('.workspace-opening')).toHaveCount(0);
    if (viewport.width === 390) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-area-top', '44px');
        document.documentElement.style.setProperty('--safe-area-bottom', '34px');
      });
    }
    const control = page.locator('.robot-control');
    const trigger = control.locator('summary');
    const add = page.getByRole('button', { name: 'Add workspace panel', exact: true });
    await expect(add).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('toolbar.png') });
    const controlBox = (await trigger.boundingBox())!;
    const addBox = (await add.boundingBox())!;
    expect(controlBox.x).toBeGreaterThanOrEqual(addBox.x + addBox.width);
    await add.click();
    await expect(page.locator('.workspace-add-menu')).toBeVisible();
    await add.click();
    await trigger.click();
    const menu = control.locator('.robot-control-popover');
    await expect(menu).toBeVisible();
    await control.getByLabel('Session name').fill('Alice');
    await control.getByRole('button', { name: 'Set name', exact: true }).click();
    await expect(control.getByRole('button', { name: 'Saved', exact: true })).toBeDisabled();
    await expect(control.getByText('Name saved as Alice.', { exact: true })).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
    expect(menuBox.y).toBeGreaterThanOrEqual(addBox.y + addBox.height);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath('control-menu.png') });
    await control.getByRole('button', { name: 'Request control', exact: true }).click();
    await expect(trigger).toHaveText('Control: you');
    await control.getByRole('button', { name: 'Release control', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await add.click();
    await expect(menu).toBeHidden();
    await expect(page.locator('.workspace-add-menu')).toBeVisible();
  });
}
