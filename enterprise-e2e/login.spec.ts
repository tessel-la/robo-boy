import { expect, test, type Page } from '@playwright/test';

const openAccount = async (page: Page) => page.getByRole('button', { name: /Switch connections/ }).click();

const welcomeTitle = /^(Your robotics workspace|Your robots\. One workspace\.)$/;

for (const width of [1280, 320]) {
  test(`company welcome is a stable surprise without navigation at ${width}px`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install();
    await page.goto('/');
    const heading = page.locator('#enterprise-login-title');
    const signIn = page.getByRole('button', { name: 'Sign in with your company account' });
    await expect(signIn).toBeEnabled();
    await expect(heading).toHaveText(welcomeTitle);
    const first = await heading.innerText();
    const before = await signIn.boundingBox();
    await page.clock.runFor(60000);
    await expect(heading).toHaveText(first);
    expect((await signIn.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    await expect(
      page.getByRole('button', { name: /Previous message|Next message|Pause messages|Play messages/ })
    ).toHaveCount(0);
    await page.reload();
    await expect(signIn).toBeEnabled();
    await expect(heading).toHaveText(welcomeTitle);
    expect(await heading.innerText()).not.toBe(first);

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/roboboy-login-surprise-${browserName}-${width}.png` });
    expect((await page.request.get('/recordings/list')).status()).toBe(401);
    await signIn.click();
    await expect(page.getByRole('button', { name: /Quick Connect/ })).toBeVisible();
  });
}

test('reduced motion keeps one welcome message with no playback controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/');
  const heading = page.locator('#enterprise-login-title');
  await expect(heading).toHaveText(welcomeTitle);
  const first = await heading.innerText();
  await page.clock.runFor(60000);
  await expect(heading).toHaveText(first);
  await expect(
    page.getByRole('button', { name: /Previous message|Next message|Pause messages|Play messages/ })
  ).toHaveCount(0);
});

test('branded company login protects the workspace and backend, then signs out', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#enterprise-login-title')).toHaveText(welcomeTitle);
  const firstWelcome = await page.locator('#enterprise-login-title').innerText();
  await expect(page.getByText('Example Manufacturing', { exact: true })).toBeVisible();
  await expect(page.locator('.enterprise-login-footer .robo-boy-attribution')).toHaveText('Powered by Robo-Boy');
  await expect(page.getByRole('button', { name: /Quick Connect/ })).toHaveCount(0);
  expect((await request.get('/recordings/list')).status()).toBe(401);
  await page.getByRole('button', { name: 'Sign in with your company account' }).click();
  await openAccount(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByText('Alice Employee', { exact: true })).toBeVisible();
  await expect(page.locator('.connection-switcher-attribution')).toHaveText('Powered by Robo-Boy');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Quick Connect/ })).toBeVisible();
  await expect(page.locator('.entry-attribution')).toHaveText('Powered by Robo-Boy');
  await page.getByTitle('Advanced Options').click();
  await expect(page.getByRole('textbox', { name: 'Host or IP:' })).toBeVisible();
  await page.getByText('Connection ports', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'ROS', exact: true })).toHaveValue('9090');
  await openAccount(page);
  expect((await page.request.get('/recordings/list')).status()).toBe(200);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#enterprise-login-title')).toHaveText(welcomeTitle);
  expect(await page.locator('#enterprise-login-title').innerText()).not.toBe(firstWelcome);
  expect((await page.request.get('/recordings/list')).status()).toBe(401);
});

test('native sign-in uses the system-browser handoff and explicit account confirmation', async ({ page, context }) => {
  await page.exposeBinding('testOpenEnterpriseLogin', async (_source, url: string) => {
    const browser = await context.newPage();
    await browser.goto(url);
    await expect(browser.getByRole('heading', { name: 'Sign-in complete' })).toBeVisible();
    await browser.close();
    // Match returning to the native app after system-browser sign-in. Firefox's text input
    // insertion can otherwise target the closed sign-in tab instead of the app fixture.
    await page.bringToFront();
  });
  await page.addInitScript(() => {
    const testWindow = window as unknown as {
      roboBoyDesktop: unknown;
      testOpenEnterpriseLogin: (url: string) => Promise<void>;
    };
    testWindow.roboBoyDesktop = {
      shell: 'electron',
      getUsername: async () => 'Local user',
      openEnterpriseLogin: (url: string) => testWindow.testOpenEnterpriseLogin(url),
      window: {
        isMaximized: async () => false,
        onResized: async () => () => {},
        minimize: async () => {},
        toggleMaximize: async () => {},
        close: async () => {},
        startResizeDragging: async () => {},
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with your company account' }).click();
  await expect(page.getByRole('button', { name: 'Continue as Alice Employee' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Quick Connect/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue as Alice Employee' }).click();
  await openAccount(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Host or IP:' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Host or IP:' }).fill('127.0.0.1');
  await expect(page.getByRole('textbox', { name: 'Host or IP:' })).toHaveValue('127.0.0.1');
  await page.getByText('Connection ports', { exact: true }).click();
  await page.getByRole('textbox', { name: 'ROS', exact: true }).fill('5282');
  const sent: string[] = [];
  page.on('websocket', socket => socket.on('framesent', event => sent.push(String(event.payload))));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 15000 });
  expect(sent.some(frame => frame.includes('roboboy_auth'))).toBe(false);
  await openAccount(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in with your company account' })).toBeVisible();
  await expect(page.getByLabel('Status: Connected')).toHaveCount(0);
});

test('login remains usable on a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const login = page.getByRole('button', { name: 'Sign in with your company account' });
  await expect(login).toBeVisible();
  const box = (await login.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await login.click();
  await openAccount(page);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('.enterprise-account')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
