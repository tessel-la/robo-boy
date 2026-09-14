import type { AssistantProviderId } from '../providers/types';
import type { AssistantSettings, StoredAssistantMessage } from '../types';

const SETTINGS_STORAGE_KEY = 'robo-boy-assistant-settings';
const CONVERSATION_STORAGE_KEY = 'robo-boy-assistant-conversation-v1';
const CONVERSATION_VERSION = 1;
/** Cap persisted history so localStorage never grows unbounded across a long-lived session. */
const MAX_PERSISTED_MESSAGES = 100;

const PROVIDER_DEFAULTS: Record<AssistantProviderId, Pick<AssistantSettings, 'baseUrl' | 'model'>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  ollama: { baseUrl: '/ollama', model: '' },
  'openai-compatible': { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5' },
};

const getOllamaDefaultBaseUrl = (): string => {
  const desktop =
    typeof window !== 'undefined' && (window.location.protocol === 'tauri:' || '__TAURI_INTERNALS__' in window);
  return desktop ? 'http://localhost:11434' : '/ollama';
};

export const getProviderDefaults = (provider: AssistantProviderId) => ({
  ...PROVIDER_DEFAULTS[provider],
  ...(provider === 'ollama' ? { baseUrl: getOllamaDefaultBaseUrl() } : {}),
});

export const getDefaultAssistantSettings = (): AssistantSettings => ({
  provider: 'openai-compatible',
  apiKey: '',
  ...PROVIDER_DEFAULTS['openai-compatible'],
  systemContext: '',
  robotContext: '',
  ollamaUseBackendHost: true,
  voiceLanguage: '',
});

export const loadAssistantSettings = (): AssistantSettings => {
  const defaults = getDefaultAssistantSettings();
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
};

export const saveAssistantSettings = (settings: AssistantSettings): void => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Unable to save assistant settings to localStorage.', error);
  }
};

interface StoredConversationEnvelope {
  version: number;
  messages: StoredAssistantMessage[];
}

/** Persists only role/content/timestamp — never attachments (large/ephemeral) or provider
 * settings (kept separately, see above, and never written into this envelope). */
export const loadAssistantConversation = (): StoredAssistantMessage[] => {
  try {
    const stored = localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as StoredConversationEnvelope;
    if (parsed.version !== CONVERSATION_VERSION || !Array.isArray(parsed.messages)) return [];
    return parsed.messages.filter(
      (message): message is StoredAssistantMessage =>
        Boolean(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    );
  } catch {
    return [];
  }
};

export const saveAssistantConversation = (messages: StoredAssistantMessage[]): void => {
  try {
    const envelope: StoredConversationEnvelope = {
      version: CONVERSATION_VERSION,
      messages: messages.slice(-MAX_PERSISTED_MESSAGES),
    };
    localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(envelope));
  } catch (error) {
    console.warn('Unable to save assistant conversation to localStorage.', error);
  }
};

export const clearAssistantConversation = (): void => {
  try {
    localStorage.removeItem(CONVERSATION_STORAGE_KEY);
  } catch {
    /* best effort */
  }
};
