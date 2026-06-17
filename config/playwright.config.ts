import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const isStackRun = process.env.npm_lifecycle_event === 'e2e:stack';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? (isStackRun ? 'http://127.0.0.1' : 'http://127.0.0.1:5173');
const skipWebServer = isStackRun || process.env.PLAYWRIGHT_SKIP_WEB_SERVER === '1';
const webServer = {
    command: 'VITE_PWA_DEV=false npm run dev',
    cwd: projectRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
};

/**
 * Playwright configuration for E2E tests
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: resolve(projectRoot, 'e2e'),
    outputDir: resolve(projectRoot, 'test-results'),
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: [['html', { outputFolder: resolve(projectRoot, 'playwright-report') }], ['list']],
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL,
        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
        /* Take screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    /* Run your local dev server before starting the tests */
    webServer: skipWebServer ? undefined : webServer,
});
