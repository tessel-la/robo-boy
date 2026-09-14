import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAssistantConversation,
  getDefaultAssistantSettings,
  getProviderDefaults,
  loadAssistantConversation,
  loadAssistantSettings,
  saveAssistantConversation,
  saveAssistantSettings,
} from './assistantStorage';

describe('assistantStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns provider defaults for all five providers and baseline local settings', () => {
    expect(getProviderDefaults('openai')).toEqual({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' });
    expect(getProviderDefaults('gemini')).toEqual({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
    });
    expect(getProviderDefaults('ollama')).toEqual({ baseUrl: '/ollama', model: '' });
    expect(getProviderDefaults('anthropic')).toEqual({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' });
    expect(getDefaultAssistantSettings()).toMatchObject({
      provider: 'openai-compatible',
      ollamaUseBackendHost: true,
      baseUrl: 'http://localhost:11434/v1',
    });
  });

  it('persists settings and falls back to defaults when storage is malformed', () => {
    const settings = { ...getDefaultAssistantSettings(), model: 'local-model', robotContext: 'x forward' };
    saveAssistantSettings(settings);

    expect(loadAssistantSettings()).toMatchObject({ model: 'local-model', robotContext: 'x forward' });

    localStorage.setItem('robo-boy-assistant-settings', '{broken');
    expect(loadAssistantSettings()).toEqual(getDefaultAssistantSettings());
  });

  it('connects directly to local Ollama from the desktop runtime', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    try {
      expect(getProviderDefaults('ollama').baseUrl).toBe('http://localhost:11434');
    } finally {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it('persists conversation history (a capability the old BT-owned assistant never had)', () => {
    expect(loadAssistantConversation()).toEqual([]);
    const messages = [
      { role: 'user' as const, content: 'Hello', createdAt: 1 },
      { role: 'assistant' as const, content: 'Hi there', createdAt: 2 },
    ];
    saveAssistantConversation(messages);
    expect(loadAssistantConversation()).toEqual(messages);

    clearAssistantConversation();
    expect(loadAssistantConversation()).toEqual([]);
  });

  it('caps persisted conversation history and ignores malformed or version-mismatched storage', () => {
    const many = Array.from({ length: 150 }, (_, index) => ({ role: 'user' as const, content: `msg-${index}`, createdAt: index }));
    saveAssistantConversation(many);
    const loaded = loadAssistantConversation();
    expect(loaded.length).toBeLessThanOrEqual(100);
    expect(loaded[loaded.length - 1].content).toBe('msg-149');

    localStorage.setItem('robo-boy-assistant-conversation-v1', JSON.stringify({ version: 999, messages: many }));
    expect(loadAssistantConversation()).toEqual([]);

    localStorage.setItem('robo-boy-assistant-conversation-v1', 'not json');
    expect(loadAssistantConversation()).toEqual([]);
  });
});
