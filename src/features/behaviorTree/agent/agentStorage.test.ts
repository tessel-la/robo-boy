import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultAgentSettings,
  getProviderDefaults,
  loadAgentSettings,
  saveAgentSettings,
} from './agentStorage';

describe('agentStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns provider defaults and baseline local settings', () => {
    expect(getProviderDefaults('openai')).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
    });
    expect(getProviderDefaults('gemini')).toEqual({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
    });
    expect(getProviderDefaults('ollama')).toEqual({
      baseUrl: '/ollama',
      model: '',
    });
    expect(getDefaultAgentSettings()).toMatchObject({
      provider: 'openai-compatible',
      includeCurrentTree: true,
      ollamaUseBackendHost: true,
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('persists settings and falls back to defaults when storage is malformed', () => {
    const settings = {
      ...getDefaultAgentSettings(),
      model: 'local-model',
      robotContext: 'x forward',
    };
    saveAgentSettings(settings);

    expect(loadAgentSettings()).toMatchObject({
      model: 'local-model',
      robotContext: 'x forward',
    });

    localStorage.setItem('robo-boy-bt-agent-settings', '{broken');
    expect(loadAgentSettings()).toEqual(getDefaultAgentSettings());
  });

  it('connects directly to local Ollama from the desktop runtime', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      expect(getProviderDefaults('ollama').baseUrl).toBe('http://localhost:11434');
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });
});
