import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: resolve('enterprise-e2e'),
  outputDir: resolve('test-results/enterprise'),
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5280', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], headless: process.env.CI ? false : undefined } },
  ],
  webServer: {
    command: 'node scripts/run-enterprise-e2e.mjs',
    cwd: resolve('.'),
    url: 'http://127.0.0.1:5280/',
    timeout: 60000,
    reuseExistingServer: false,
  },
});
