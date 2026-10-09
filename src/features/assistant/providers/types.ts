// Provider-agnostic chat transport contract. Every vendor file in this directory implements
// `sendChat` against this shape so the rest of the assistant never branches on provider identity.

export type AssistantProviderId = 'openai' | 'gemini' | 'ollama' | 'openai-compatible' | 'anthropic';

export interface AssistantProviderSettings {
  provider: AssistantProviderId;
  /** Missing in older saved settings means API-key authentication. */
  authMode?: import('../../../runtime/assistantSubscription').AssistantAuthMode;
  apiKey: string;
  baseUrl: string;
  model: string;
  thinkingEffort?: import('./thinking').ThinkingEffort;
}

export interface AssistantChatImage {
  mimeType: string;
  /** Base64 payload without the `data:` URL prefix. */
  data: string;
}

export interface AssistantChatTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: AssistantChatImage[];
}

export interface SendChatRequest {
  beforeStep?: () => void;
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  onNativeMessages?: (messages: import('ai').ModelMessage[]) => void;
  nativeHistory?: import('ai').ModelMessage[];
  contextWindowTokens?: number;
  sessionId?: string;
  shouldYield?: () => boolean;
  tools?: import('../tools/nativeTools').HostTools;
  refreshSystemPrompt?: () => string;
  settings: AssistantProviderSettings;
  systemPrompt: string;
  /** Full multi-turn history, oldest first, ending with the current user turn. */
  messages: AssistantChatTurn[];
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  /** Only provider-exposed reasoning/thinking, kept separate from answer text. */
  onThinking?: (text: string) => void;
  onProgress?: (message: string) => void;
  /** Ask the provider to constrain output to a single JSON object, using whatever native
   * mechanism it offers (or a system-prompt instruction, for providers with none). */
  jsonMode?: boolean;
}

export type SendChat = (request: SendChatRequest) => Promise<string>;
