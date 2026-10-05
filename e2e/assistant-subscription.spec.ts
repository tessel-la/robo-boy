import { test, expect } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('switches both providers between API and native sign-in, then sends a subscription turn', async ({ page }) => {
  await page.addInitScript(() => {
    const keys: Record<string, string> = {};
    const storage: Record<string, { policy: string; storage: string; warning?: string }> = {};
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', model: 'gpt-4.1', apiKey: 'legacy-test-key' })
    );
    let connected = false;
    const snapshot = (provider: string) => ({
      activeAccountId: connected ? 'account' : undefined,
      accounts: connected ? [{ id: 'account', label: 'user@example.test', connected: true, planEnabled: true }] : [],
      models: connected ? [{ id: provider === 'openai' ? 'gpt-6.1-sol' : 'sonnet', label: 'Subscription model' }] : [],
    });
    (window as any).roboBoyDesktop = {
      shell: 'electron',
      nativeWindowControls: true,
      window: {
        isMaximized: async () => false,
        onResized: async () => () => {},
        minimize: async () => {},
        toggleMaximize: async () => {},
        close: async () => {},
      },
      fetchPanelAsset: async () => ({
        status: 200,
        headers: {},
        body: new TextEncoder().encode('{"schemaVersion":1,"panels":[]}').buffer,
      }),
      assistant: {
        getApiKey: async (provider: string) => keys[provider],
        getApiKeyStorage: async (provider: string) => storage[provider] ?? { policy: 'automatic', storage: 'none' },
        setApiKey: async (provider: string, key: string, policy?: string) => {
          keys[provider] = key;
          const selected = policy ?? storage[provider]?.policy ?? 'automatic';
          storage[provider] = {
            policy: selected,
            storage: selected === 'local' ? 'plaintext' : 'session',
            warning:
              selected === 'local'
                ? 'Saved unencrypted on this device. Someone with access to your app files or backups can read this key.'
                : 'Secure storage is unavailable. This key works for this app session.',
          };
          return storage[provider];
        },
        getState: async (provider: string) => snapshot(provider),
        signIn: async (provider: string) => {
          connected = true;
          return snapshot(provider);
        },
        cancelSignIn: async () => {},
        selectAccount: async (provider: string) => snapshot(provider),
        signOut: async (provider: string) => {
          connected = false;
          return snapshot(provider);
        },
        manageUsage: async () => {},
        cancel: async () => {},
        send: async (_id: string, request: any) => {
          if (request.thinkingEffort !== 'high') throw new Error('Thinking effort was not forwarded.');
          if ('apiKey' in request || 'baseUrl' in request)
            throw new Error('Credentials crossed the subscription bridge.');
          return '{"kind":"explanation","message":"Subscription connection works."}';
        },
      },
    };
  });
  await installRosMock(page);
  await page.goto('/');
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  await panel.getByRole('button', { name: 'Assistant settings' }).click();
  const settings = panel.getByRole('dialog', { name: 'Assistant settings' });
  await expect(settings.getByRole('status')).toHaveText(/Secure storage is unavailable/);
  await settings.getByRole('combobox', { name: 'Remember API key' }).selectOption('local');
  await expect(settings.getByRole('status')).toHaveText(/Saved unencrypted on this device/);
  await expect(settings.getByLabel('API key', { exact: true })).toHaveValue('legacy-test-key');
  await page.screenshot({ path: 'test-results/assistant-key-storage.png' });
  expect(await page.evaluate(() => localStorage.getItem('robo-boy-assistant-settings'))).not.toContain(
    'legacy-test-key'
  );
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('openai');
  await settings.getByRole('combobox', { name: 'Authentication', exact: true }).selectOption('subscription');
  await expect(settings.getByRole('textbox', { name: 'API key', exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: 'Continue with ChatGPT' }).click();
  await expect(settings.getByText('Using ChatGPT subscription')).toBeVisible();
  await expect(settings.getByLabel('ChatGPT subscription model')).toHaveValue('gpt-6.1-sol');
  await settings.getByRole('combobox', { name: 'Thinking effort' }).selectOption('high');
  await expect(settings.getByRole('combobox', { name: 'Thinking effort' })).toHaveValue('high');
  expect(await page.evaluate(() => localStorage.getItem('robo-boy-assistant-settings'))).not.toContain(
    'legacy-test-key'
  );
  await page.screenshot({ path: 'test-results/assistant-chatgpt-settings.png' });
  await settings.getByRole('combobox', { name: 'Authentication', exact: true }).selectOption('api-key');
  await expect(settings.getByRole('textbox', { name: 'API key', exact: true })).toBeVisible();
  await settings.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('anthropic');
  await settings.getByRole('combobox', { name: 'Authentication', exact: true }).selectOption('subscription');
  await expect(settings.getByText(/Using Claude Code subscription/)).toBeVisible();
  await expect(settings.getByLabel('Claude Code subscription model')).toHaveValue('sonnet');
  await settings.getByRole('button', { name: 'Sign out', exact: true }).click();
  await settings.getByRole('button', { name: 'Sign in through Claude Code' }).click();
  await expect(settings.getByText(/Using Claude Code subscription/)).toBeVisible();
  await settings.getByRole('combobox', { name: 'Thinking effort' }).selectOption('high');
  await page.screenshot({ path: 'test-results/assistant-claude-settings.png' });
  await panel.getByRole('button', { name: 'Back to assistant' }).click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Check the connection.');
  await page.keyboard.press('Enter');
  await expect(panel.getByText('Subscription connection works.')).toBeVisible();
});
