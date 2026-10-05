import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAssistantSettings } from './useAssistantSettings';

describe('native API-key migration', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());
  it('migrates a legacy key before removing it from browser storage, and restores it in memory', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    let stored: string | undefined;
    const setApiKey = vi.fn(async (_provider: string, key: string) => {
      stored = key;
    });
    vi.stubGlobal('roboBoyDesktop', { assistant: { setApiKey, getApiKey: vi.fn(async () => stored) } });
    const { result, unmount } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    expect(setApiKey).toHaveBeenCalledWith('openai', 'legacy-secret');
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('legacy-secret');
    expect(result.current.settings.apiKey).toBe('legacy-secret');
    act(() => result.current.updateSettings({ apiKey: 'updated-secret' }));
    await waitFor(() => expect(stored).toBe('updated-secret'));
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('updated-secret');
    unmount();
    const restored = renderHook(useAssistantSettings);
    await waitFor(() => expect(restored.result.current.settings.apiKey).toBe('updated-secret'));
  });
  it('retains the legacy record if native migration fails rather than losing the user key', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        setApiKey: vi.fn(async () => {
          throw new Error('locked');
        }),
        getApiKey: vi.fn(),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.storageError).toMatch(/existing records are retained/i));
    act(() => result.current.updateSettings({ model: 'new-model' }));
    expect(localStorage.getItem('robo-boy-assistant-settings')).toContain('legacy-secret');
    expect(result.current.settings.apiKey).toBe('legacy-secret');
  });
  it('does not replace a newly edited key with a late hydration response', async () => {
    localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai', apiKey: '' }));
    let finish!: (key: string) => void;
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        setApiKey: vi.fn(async () => {}),
        getApiKey: vi.fn(
          () =>
            new Promise<string>(resolve => {
              finish = resolve;
            })
        ),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(finish).toBeDefined());
    act(() => result.current.updateSettings({ apiKey: 'new-secret' }));
    await act(async () => finish('old-secret'));
    expect(result.current.settings.apiKey).toBe('new-secret');
  });
  it('completes failed migration when the user re-enters a key after a storage failure', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    let key: string | undefined;
    const setApiKey = vi.fn(async (_provider: string, value: string) => {
      key = value;
    });
    setApiKey.mockRejectedValueOnce(new Error('locked'));
    vi.stubGlobal('roboBoyDesktop', { assistant: { setApiKey, getApiKey: vi.fn(async () => key) } });
    const { result, unmount } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.storageError).toContain('Could not load'));
    act(() => result.current.updateSettings({ apiKey: 'new-secret' }));
    await waitFor(() => expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('legacy-secret'));
    unmount();
    const restored = renderHook(useAssistantSettings);
    await waitFor(() => expect(restored.result.current.settings.apiKey).toBe('new-secret'));
    expect(setApiKey).toHaveBeenCalledTimes(2);
  });
  it('ignores an old load failure after the user has entered and saved a replacement key', async () => {
    localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai', apiKey: '' }));
    let rejectLoad!: (error: Error) => void;
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        setApiKey: vi.fn(async () => {}),
        getApiKey: vi.fn(
          () =>
            new Promise<string>((_resolve, reject) => {
              rejectLoad = reject;
            })
        ),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(rejectLoad).toBeDefined());
    act(() => result.current.updateSettings({ apiKey: 'replacement-secret' }));
    await act(async () => rejectLoad(new Error('Old encrypted key unavailable')));
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    expect(result.current.storageError).toBe('');
    expect(result.current.settings.apiKey).toBe('replacement-secret');
  });
  it('does not overwrite a key edited while the initial migration read is pending', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    let finish!: (key: undefined) => void;
    let stored: string | undefined;
    const setApiKey = vi.fn(async (_provider: string, key: string) => {
      stored = key;
    });
    const getApiKey = vi.fn(async () => stored);
    getApiKey.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    vi.stubGlobal('roboBoyDesktop', { assistant: { getApiKey, setApiKey } });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(finish).toBeDefined());
    act(() => result.current.updateSettings({ apiKey: 'edited-secret' }));
    await act(async () => finish(undefined));
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    expect(stored).toBe('edited-secret');
    expect(setApiKey).toHaveBeenCalledTimes(1);
    expect(result.current.settings.apiKey).toBe('edited-secret');
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('legacy-secret');
  });
  it('recovers from a preserved encrypted record through explicit re-entry without unlocking it', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    let stored: string | undefined;
    const getApiKey = vi.fn(async () => stored);
    getApiKey.mockRejectedValueOnce(new Error('A previous encrypted API-key record exists.'));
    const setApiKey = vi.fn(async (_provider: string, key: string) => {
      stored = key;
    });
    vi.stubGlobal('roboBoyDesktop', { assistant: { getApiKey, setApiKey } });
    const { result, unmount } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.storageError).toContain('enter it once again'));
    expect(setApiKey).not.toHaveBeenCalled();
    expect(localStorage.getItem('robo-boy-assistant-settings')).toContain('legacy-secret');
    act(() => result.current.updateSettings({ apiKey: 're-entered-secret' }));
    await waitFor(() => expect(stored).toBe('re-entered-secret'));
    expect(result.current.storageError).toBe('');
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('legacy-secret');
    unmount();
    const restored = renderHook(useAssistantSettings);
    await waitFor(() => expect(restored.result.current.settings.apiKey).toBe('re-entered-secret'));
  });
  it.each(['native-new-key', ''])('does not resurrect a stale browser key over a native record (%s)', async key => {
    localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai', apiKey: 'stale-secret' }));
    const setApiKey = vi.fn(async () => {});
    vi.stubGlobal('roboBoyDesktop', { assistant: { setApiKey, getApiKey: vi.fn(async () => key) } });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    expect(result.current.settings.apiKey).toBe(key);
    expect(setApiKey).not.toHaveBeenCalled();
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('stale-secret');
  });
  it('migrates into session memory when encryption is unavailable and shows the native warning', async () => {
    localStorage.setItem(
      'robo-boy-assistant-settings',
      JSON.stringify({ provider: 'openai', apiKey: 'legacy-secret' })
    );
    let key: string | undefined;
    const state = { policy: 'automatic', storage: 'session', warning: 'Secure storage is unavailable.' };
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        getApiKey: vi.fn(async () => key),
        setApiKey: vi.fn(async (_provider: string, value: string) => {
          key = value;
          return state;
        }),
        getApiKeyStorage: vi.fn(async () => state),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    expect(result.current.settings.apiKey).toBe('legacy-secret');
    expect(result.current.apiKeyStorage).toEqual(state);
    expect(result.current.storageError).toBe('');
    expect(localStorage.getItem('robo-boy-assistant-settings')).not.toContain('legacy-secret');
  });
  it('forwards an explicit storage choice and ignores a late result from an earlier choice', async () => {
    localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai', apiKey: '' }));
    let finish!: (state: any) => void;
    const setApiKey = vi.fn(async (_provider: string, _key: string, policy: string) => ({
      policy,
      storage: 'session',
    }));
    setApiKey.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        getApiKey: vi.fn(async () => 'saved-key'),
        setApiKey,
        getApiKeyStorage: vi.fn(async () => ({ policy: 'automatic', storage: 'encrypted' })),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(result.current.loadingCredentials).toBe(false));
    act(() => result.current.updateApiKeyStorage('local'));
    act(() => result.current.updateApiKeyStorage('session'));
    await waitFor(() => expect(result.current.apiKeyStorage?.policy).toBe('session'));
    await act(async () => finish({ policy: 'local', storage: 'plaintext' }));
    expect(result.current.apiKeyStorage?.policy).toBe('session');
    expect(setApiKey).toHaveBeenNthCalledWith(1, 'openai', 'saved-key', 'local');
    expect(setApiKey).toHaveBeenNthCalledWith(2, 'openai', 'saved-key', 'session');
  });
  it('allows immediate use of an edited key even while the old native load is pending', async () => {
    let finish!: (key: string) => void;
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        getApiKey: vi.fn(
          () =>
            new Promise(resolve => {
              finish = resolve;
            })
        ),
        setApiKey: vi.fn(async () => ({ policy: 'automatic', storage: 'session' })),
      },
    });
    const { result } = renderHook(useAssistantSettings);
    await waitFor(() => expect(finish).toBeDefined());
    expect(result.current.loadingCredentials).toBe(true);
    act(() => result.current.updateSettings({ apiKey: 'usable-key' }));
    expect(result.current.loadingCredentials).toBe(false);
    expect(result.current.settings.apiKey).toBe('usable-key');
    await act(async () => finish('older-key'));
    expect(result.current.settings.apiKey).toBe('usable-key');
  });
});
