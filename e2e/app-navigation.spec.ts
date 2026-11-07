import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test.describe('App Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');
    });

    test('opens and closes the connection options from the entry screen', async ({ page }) => {
        const disclosure = page.getByTitle('Advanced Options');
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#ros2Value')).toBeVisible();
        await disclosure.click();
        await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
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

        await expect(page.locator('.entry-section')).toBeVisible();
        await expect(page.getByRole('button', { name: /Quick Connect/ })).toBeEnabled();
    });
});

test.describe('PWA Features', () => {
    test('should have manifest link', async ({ page }) => {
        await page.goto('/');

        const manifestLink = page.locator('link[rel="manifest"][href="./manifest.webmanifest"]');
        await expect(manifestLink).toHaveCount(1);
        const response = await page.request.get('/manifest.webmanifest');
        expect(response.ok()).toBe(true);
        expect(await response.json()).toMatchObject({ name: 'Robo-Boy' });
    });

    // Desktop systems and browsers show these icons as drawn, so they carry their own rounded
    // corners; iOS and Android mask theirs and need an opaque square.
    test('ships every manifest icon, rounded except where the platform masks it', async ({ page }) => {
        const { icons } = await (await page.request.get('/manifest.webmanifest')).json();
        for (const icon of icons as { src: string; sizes: string; purpose?: string }[]) {
            const response = await page.request.get(icon.src);
            expect(response.headers()['content-type'], icon.src).toBe('image/png');
            const image = sharp(await response.body());
            const { width, height } = await image.metadata();
            expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
            const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            const cornerAlpha = data[info.channels - 1];
            const masked = icon.purpose === 'maskable' || /apple|ios/.test(icon.src);
            expect(cornerAlpha, icon.src).toBe(masked ? 255 : 0);
        }
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
