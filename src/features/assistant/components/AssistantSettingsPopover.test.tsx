import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssistantSettingsPopover from './AssistantSettingsPopover';
import { getDefaultAssistantSettings } from '../storage/assistantStorage';
import type { AssistantSettings } from '../types';
import type { ApiKeyStorageState, ApiKeyStoragePolicy } from '../../../runtime/assistantSubscription';

function Settings({
  storage,
  onStorageChange,
  loading,
}: { storage?: ApiKeyStorageState; onStorageChange?: (policy: ApiKeyStoragePolicy) => void; loading?: boolean } = {}) {
  const [settings, setSettings] = useState<AssistantSettings>({
    ...getDefaultAssistantSettings(),
    provider: 'openai',
    model: 'api-model',
    apiKey: 'saved-api-key',
  });
  return (
    <AssistantSettingsPopover
      settings={settings}
      resolvedBaseUrl={settings.baseUrl}
      onProviderChange={provider => setSettings(previous => ({ ...previous, provider, authMode: 'api-key' }))}
      onUpdate={patch => setSettings(previous => ({ ...previous, ...patch }))}
      ollamaModels={[]}
      ollamaModelsError=""
      isLoadingOllamaModels={false}
      onRefreshOllamaModels={() => {}}
      apiKeyStorage={storage}
      onApiKeyStorageChange={onStorageChange}
      loadingCredentials={loading}
    />
  );
}

describe('provider authentication settings', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('connects a subscription and chooses its model without displaying or discarding the saved API key', async () => {
    const connected = {
      activeAccountId: 'account',
      accounts: [{ id: 'account', label: 'user@example.test', connected: true, planEnabled: true }],
      models: [{ id: 'plan-model', label: 'Plan model' }],
    };
    const assistant = {
      getState: vi.fn(async () => ({ accounts: [], models: [] })),
      signIn: vi.fn(async () => connected),
      cancelSignIn: vi.fn(async () => {}),
      manageUsage: vi.fn(),
    };
    vi.stubGlobal('roboBoyDesktop', { assistant });
    render(<Settings />);
    expect(screen.getByLabelText('API key')).toHaveValue('saved-api-key');
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'subscription' } });
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.queryByLabelText('Base URL')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    await screen.findByText('Using ChatGPT subscription');
    expect(assistant.signIn).toHaveBeenCalledWith('openai', undefined);
    expect(screen.getByLabelText('ChatGPT subscription model')).toHaveValue('plan-model');
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'api-key' } });
    expect(screen.getByLabelText('API key')).toHaveValue('saved-api-key');
  });
  it('explains the desktop requirement on other platforms', () => {
    render(<Settings />);
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'subscription' } });
    expect(screen.getByText(/Subscription sign-in is available in the updated/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with ChatGPT' })).toBeNull();
  });
  it('keeps malformed post-login replies inside settings instead of crashing the application', async () => {
    const assistant = {
      getState: vi.fn(async () => ({ accounts: [], models: [] })),
      signIn: vi.fn(async () => ({ accounts: [], models: null })),
      cancelSignIn: vi.fn(async () => {}),
    };
    vi.stubGlobal('roboBoyDesktop', { assistant });
    render(<Settings />);
    fireEvent.change(screen.getByLabelText('Authentication'), { target: { value: 'subscription' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }));
    await screen.findByText(/invalid account state/);
    expect(screen.getByRole('dialog', { name: 'Assistant settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  });
  it('offers thinking effort for a supported model and resets it on model change', () => {
    render(<Settings />);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-6.1-sol' } });
    const select = screen.getByRole('combobox', { name: 'Thinking effort' });
    fireEvent.change(select, { target: { value: 'high' } });
    expect(select).toHaveValue('high');
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4.1' } });
    expect(screen.queryByRole('combobox', { name: 'Thinking effort' })).toBeNull();
  });
  it('shows the session fallback and offers explicit plaintext saving without a confirmation dialog', () => {
    vi.stubGlobal('roboBoyDesktop', { assistant: { getApiKeyStorage: vi.fn(), setApiKey: vi.fn() } });
    const onStorageChange = vi.fn();
    render(
      <Settings
        storage={{
          policy: 'automatic',
          storage: 'session',
          warning: 'Secure storage is unavailable. This key works for this session.',
        }}
        onStorageChange={onStorageChange}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('This key works for this session');
    fireEvent.change(screen.getByRole('combobox', { name: 'Remember API key' }), { target: { value: 'local' } });
    expect(onStorageChange).toHaveBeenCalledWith('local');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('prevents a storage-policy change from replacing a key before hydration finishes', () => {
    vi.stubGlobal('roboBoyDesktop', { assistant: { getApiKeyStorage: vi.fn(), setApiKey: vi.fn() } });
    render(<Settings loading onStorageChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Remember API key' })).toBeDisabled();
  });
});
