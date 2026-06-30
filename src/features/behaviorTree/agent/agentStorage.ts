import { AgentProvider, BehaviorTreeAgentSettings } from './types';

const STORAGE_KEY = 'robo-boy-bt-agent-settings';

const PROVIDER_DEFAULTS: Record<AgentProvider, Pick<BehaviorTreeAgentSettings, 'baseUrl' | 'model'>> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
  'openai-compatible': { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
};

export const getProviderDefaults = (provider: AgentProvider) => PROVIDER_DEFAULTS[provider];

export const getDefaultAgentSettings = (): BehaviorTreeAgentSettings => ({
  provider: 'openai-compatible',
  apiKey: '',
  ...PROVIDER_DEFAULTS['openai-compatible'],
  systemContext: '',
  robotContext: '',
  includeCurrentTree: true,
});

export const loadAgentSettings = (): BehaviorTreeAgentSettings => {
  const defaults = getDefaultAgentSettings();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
};

export const saveAgentSettings = (settings: BehaviorTreeAgentSettings): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

