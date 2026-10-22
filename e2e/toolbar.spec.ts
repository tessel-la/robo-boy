import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

for (const theme of ['dark', 'solarized', 'light', 'company']) {
  for (const width of [320, 1280]) {
    test(`toolbar groups align in ${theme} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await installRosMock(page, { controlMode: 'observer' });
      await page.addInitScript(theme => {
        localStorage.setItem('appTheme', theme);
        if (theme === 'company') localStorage.setItem('customThemes', JSON.stringify([{
          id: 'company', name: 'Company', colors: {
            primary: '#0071ce', secondary: '#00355a', background: '#f4f7fb',
            text: '#142c43', cardBg: '#ffffff', border: '#d5dfe9', buttonText: '#ffffff',
          },
        }]));
        localStorage.setItem('robo-boy-desktop-workspace-panels-v1', JSON.stringify([
          { id: 'toolbar-tf', type: 'tfTree', title: 'TF tree' },
        ]));
      }, theme);
      await page.goto('/');
      await page.getByRole('button', { name: /Quick Connect/ }).click();
      await expect(page.getByLabel('Status: Connected')).toBeVisible();
      await expect(page.getByTestId('tf-tree-panel')).toBeVisible();
      await expect(page.locator('.workspace-opening')).toHaveCount(0);
      const groups = await page.evaluate(() =>
        ['.connection-switcher-trigger', '.workspace-add-button', '.status-controls'].map(selector => {
          const element = document.querySelector(selector)!;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            y: rect.y, height: rect.height, background: style.backgroundColor,
            radius: style.borderRadius, border: style.borderTopWidth,
          };
        })
      );
      for (const group of groups) {
        expect(group.y).toBeCloseTo(groups[0].y, 1);
        expect(group.height).toBe(32);
        expect(group.radius).toBe(groups[0].radius);
        expect(group.border).toBe('0px');
        expect(group.background).toBe(groups[0].background);
        expect(group.background).not.toBe('rgba(0, 0, 0, 0)');
      }
      const inner = await page.locator('.robot-control summary, .connection-status-icon, .disconnect-button-icon')
        .evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { y: rect.y, height: rect.height };
        }));
      expect(inner).toHaveLength(3);
      for (const control of inner) {
        expect(control.height).toBe(28);
        expect(control.y).toBeCloseTo(groups[0].y + 2, 1);
      }
      await page.locator('.top-bar').screenshot({ path: testInfo.outputPath('toolbar.png') });
      const trigger = page.getByRole('button', { name: /Switch connections/ });
      await trigger.click();
      await expect(page.locator('.connection-switcher-popover')).toBeVisible();
      await expect(page.locator('.connection-switcher-popover')).toHaveCSS('border-top-width', '0px');
      await page.screenshot({ path: testInfo.outputPath('connections.png') });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      // A keyboard focus ring remains even though decorative outlines have been removed.
      await trigger.press('Tab');
      await trigger.focus();
      await expect(trigger).toHaveCSS('outline-style', 'solid');
      await page.locator('.robot-control summary').click();
      await expect(page.locator('.robot-control-popover')).toBeVisible();
      await expect(page.locator('.robot-control-popover')).toHaveCSS('border-top-width', '0px');
      const menu = (await page.locator('.robot-control-popover').boundingBox())!;
      expect(menu.x).toBeGreaterThanOrEqual(0);
      expect(menu.x + menu.width).toBeLessThanOrEqual(width);
    });
  }
}
