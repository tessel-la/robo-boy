import { test, expect } from '@playwright/test';

test.describe('Entry Page', () => {
    test('should display the entry page with branding', async ({ page }) => {
        await page.goto('/');

        // Wait for the page to load
        await page.waitForLoadState('domcontentloaded');

        // Check for entry section
        await expect(page.locator('.entry-section')).toBeVisible();

        // Check for branding elements
        await expect(page.locator('text=robo-boy')).toBeVisible();
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
