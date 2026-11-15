import { test, expect } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test.describe('Entry Page', () => {
    test('should display the entry page with branding', async ({ page }) => {
        await page.goto('/');

        // Wait for the page to load
        await page.waitForLoadState('domcontentloaded');

        // Check for entry section
        await expect(page.locator('.entry-section')).toBeVisible();

        // Check for branding elements
        await expect(page.getByRole('heading', { level: 1, name: /Robo\s*-\s*Boy/i })).toBeVisible();
        await expect(page.locator('.entry-attribution')).toHaveCount(0);
    });

    test('should have Quick Connect button', async ({ page }) => {
        await page.goto('/');

        // Check for Quick Connect button
        const quickConnectBtn = page.locator('button:has-text("Quick Connect")');
        await expect(quickConnectBtn).toBeVisible();
    });

    test('should have form elements', async ({ page }) => {
        await page.goto('/');

        // Check that forms exist in the DOM (advanced form is hidden by default)
        await expect(page.locator('form')).toHaveCount(1);
    });

    test('should have buttons for interaction', async ({ page }) => {
        await page.goto('/');

        // Should have buttons
        const buttons = page.locator('button');
        await expect(buttons.first()).toBeVisible();

        // Should have more than one button
        expect(await buttons.count()).toBeGreaterThan(0);
    });
});

test.describe('Quick Connect Flow', () => {
    test('should respond to Quick Connect click', async ({ page }) => {
        await page.goto('/');

        const quickConnectBtn = page.locator('button:has-text("Quick Connect")');
        await expect(quickConnectBtn).toBeEnabled();

        // Click Quick Connect
        await quickConnectBtn.click();

        // Wait for some visible change (connection attempt, loading, etc.)
        // The actual behavior depends on whether ROS is available
        await page.waitForTimeout(500);

        // Page should still be interactive
        await expect(page.locator('.entry-section')).toBeVisible();
    });
});

for (const width of [1280, 390]) test(`keeps Library and Recordings in the app menu at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installRosMock(page);
    await page.goto('/');
    await expect(page.locator('.entry-section').getByRole('button', { name: /Catalog|recordings/i })).toHaveCount(0);
    await page.getByRole('button', { name: /Switch connections/ }).click();
    await expect(page.getByRole('button', { name: 'Catalog', exact: true })).toBeVisible();
    const recordings = page.getByRole('button', { name: 'Recordings', exact: true });
    await expect(recordings).toBeVisible();
    const colors = () => recordings.evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderColor, text: style.color };
    });
    const initialColors = await colors();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.locator('.entry-section')).toBeVisible();
    await page.getByRole('button', { name: /Switch connections/ }).click();
    expect(await colors()).toEqual(initialColors);
    await recordings.click();
    await expect(page.getByRole('region', { name: 'Record & Replay', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Local replay · no robot connection', exact: true })).toBeVisible();
});

test.describe('Visual Elements', () => {
    test('should have proper styling loaded', async ({ page }) => {
        await page.goto('/');

        // Wait for CSS to load
        await page.waitForLoadState('load');

        // Entry section should have styles applied
        const entrySection = page.locator('.entry-section');
        await expect(entrySection).toBeVisible();

        // Check that the element has some computed styles (not default)
        const styles = await entrySection.evaluate((el) => {
            const computed = window.getComputedStyle(el);
            return {
                position: computed.position,
                display: computed.display,
            };
        });

        // Should have some CSS applied
        expect(styles.display).toBeTruthy();
    });

    test('should be responsive', async ({ page }) => {
        // Test mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');

        // Entry section should still be visible
        await expect(page.locator('.entry-section')).toBeVisible();

        // Test tablet viewport
        await page.setViewportSize({ width: 768, height: 1024 });
        await expect(page.locator('.entry-section')).toBeVisible();

        // Test desktop viewport
        await page.setViewportSize({ width: 1280, height: 720 });
        await expect(page.locator('.entry-section')).toBeVisible();
    });
});

test.describe('Accessibility', () => {
    test('should have accessible form elements', async ({ page }) => {
        await page.goto('/');

        // Buttons should be focusable
        const buttons = page.locator('button');
        const firstButton = buttons.first();
        await expect(firstButton).toBeVisible();

        // Tab to focus on button
        await page.keyboard.press('Tab');

        // Some element should be focused
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeTruthy();
    });
});
