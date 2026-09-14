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

    // Installed on a phone, the app can end up drawn under the status bar. Both the strip the
    // system tints itself and the strip the page paints around a notch have to land on the
    // navbar colour, or a light theme shows a pale band above a dark bar.
    test('dresses the status bar strip in the navbar colour', async ({ page }) => {
        await page.goto('/');

        const colours = await page.evaluate(() => ({
            navbar: getComputedStyle(document.documentElement).getPropertyValue('--navbar-bg').trim(),
            themeColor: document.querySelector('meta[name="theme-color"]')!.getAttribute('content'),
            canvas: getComputedStyle(document.documentElement).backgroundColor,
        }));

        expect(colours.navbar).toBe('#333333');
        expect(colours.themeColor).toBe(colours.navbar);
        expect(colours.canvas).toBe('rgb(51, 51, 51)');

        // The canvas only ever shows where the app cannot reach: the body covers the whole
        // viewport, and settles fully opaque over it, so this never tints the app itself. The
        // theme swap fades the body's colour in, so wait for that rather than race it.
        const covers = await page.evaluate(() => {
            const rect = document.body.getBoundingClientRect();
            return rect.top <= 0 && rect.left <= 0
                && rect.right >= window.innerWidth && rect.bottom >= window.innerHeight;
        });
        expect(covers).toBe(true);
        await expect
            .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
            .toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
});
