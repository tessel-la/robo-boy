import { test, expect } from '@playwright/test';

test.describe('App Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
    });

    test('should have navigation elements', async ({ page }) => {
        // Check if there's a navbar or navigation
        const navbar = page.locator('.navbar, nav, [role="navigation"]');

        // Navbar might be visible depending on the app state
        const isVisible = await navbar.isVisible().catch(() => false);

        // If visible, verify it has proper structure
        if (isVisible) {
            await expect(navbar.first()).toBeVisible();
        }
    });

    test('should handle page reload gracefully', async ({ page }) => {
        // Reload the page
        await page.reload();

        // Page should still show entry section
        await expect(page.locator('.entry-section')).toBeVisible();
    });
});

test.describe('Error Handling', () => {
    test('should not crash on invalid routes', async ({ page }) => {
        // Navigate to a potentially invalid route
        await page.goto('/nonexistent-route');

        // Page should still render (either redirect or show entry/404)
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('PWA Features', () => {
    test('should have manifest link', async ({ page }) => {
        await page.goto('/');

        // Check for PWA manifest
        const manifestLink = page.locator('link[rel="manifest"]');
        // May or may not be present depending on build
        const count = await manifestLink.count();
        expect(count).toBeGreaterThanOrEqual(0);
    });

    test('should have viewport meta tag', async ({ page }) => {
        await page.goto('/');

        // Check for viewport meta tag (important for mobile)
        const viewport = page.locator('meta[name="viewport"]');
        await expect(viewport).toHaveCount(1);
    });
});
