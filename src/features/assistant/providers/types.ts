// Provider-agnostic chat transport contract. Every vendor file in this directory implements
// `sendChat` against this shape so the rest of the assistant never branches on provider identity.

export type AssistantProviderId = 'openai' | 'gemini' | 'ollama' | 'openai-compatible' | 'anthropic';

export interface AssistantProviderSettings {
  provider: AssistantProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AssistantChatImage {
  mimeType: string;
  /** Base64 payload without the `data:` URL prefix. */
  data: string;
}

/** A recording sent to the model as audio rather than as a transcript. Only some providers accept
 * one; `providerAcceptsAudio` is the single place that says which. */
export interface AssistantChatAudio {
  mimeType: string;
  /** Base64 payload without the `data:` URL prefix. */
  data: string;
}

export interface AssistantChatTurn {
  role: 'user' | 'assistant';
  content: string;
  images?: AssistantChatImage[];
  audio?: AssistantChatAudio[];
}

/**
 * Whether a provider can take a recording as audio. Gemini accepts inline audio on its ordinary
 * models; the OpenAI chat-completions shape carries `input_audio` parts, which an audio-capable
 * model accepts and others reject. Anthropic and Ollama have no audio input at all, so a recording
 * has to become text before it can be sent to them.
 */
export const providerAcceptsAudio = (provider: AssistantProviderId): boolean =>
  provider === 'gemini' || provider === 'openai' || provider === 'openai-compatible';

export interface SendChatRequest {
  settings: AssistantProviderSettings;
  systemPrompt: string;
  /** Full multi-turn history, oldest first, ending with the current user turn. */
  messages: AssistantChatTurn[];
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onProgress?: (message: string) => void;
  /** Ask the provider to constrain output to a single JSON object, using whatever native
   * mechanism it offers (or a system-prompt instruction, for providers with none). */
  jsonMode?: boolean;
}

export type SendChat = (request: SendChatRequest) => Promise<string>;
