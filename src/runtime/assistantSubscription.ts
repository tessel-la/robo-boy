/** Public native assistant contract. Subscription credentials and executable paths stay native. */
export type SubscriptionProvider = 'openai' | 'anthropic';
export type AssistantAuthMode = 'api-key' | 'subscription';
export type ApiKeyStoragePolicy = 'automatic' | 'session' | 'local';
export interface ApiKeyStorageState {
  policy: ApiKeyStoragePolicy;
  storage: 'encrypted' | 'plaintext' | 'session' | 'none';
  warning?: string;
}
import type { AssistantProviderId } from '../features/assistant/providers/types';
import type { ThinkingEffort } from '../features/assistant/providers/thinking';
import type { HostToolResult } from '../features/assistant/tools/nativeTools';

export function subscriptionErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : 'The account connection failed.';
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export interface SubscriptionAccount {
  id: string;
  label: string;
  connected: boolean;
  planEnabled: boolean;
}

export interface SubscriptionState {
  accounts: SubscriptionAccount[];
  activeAccountId?: string;
  models: { id: string; label: string; contextWindowTokens?: number }[];
  error?: string;
}

export interface SubscriptionChatRequest {
  nativeTools?: boolean;
  toolScope?: 'read-only';
  toolNames?: string[];
  contextWindowTokens?: number;
  sessionId?: string;
  provider: SubscriptionProvider;
  model: string;
  thinkingEffort?: ThinkingEffort;
  systemPrompt: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    images?: { mimeType: string; data: string }[];
  }[];
  jsonMode?: boolean;
}
export interface NativeApiChatRequest extends Omit<SubscriptionChatRequest, 'provider'> {
  provider: AssistantProviderId;
  baseUrl: string;
}

export interface AssistantSubscriptionBridge {
  sendApi?(id: string, request: NativeApiChatRequest): Promise<string>;
  setBackgroundActive?(enabled: boolean): Promise<void>;
  notify?(title: string, body: string): Promise<void>;
  onStopMonitors?(listener: () => void): () => void;
  /** API transports need the key in renderer memory; disk persistence belongs to the native store. */
  getApiKey?(provider: AssistantProviderId): Promise<string | undefined>;
  setApiKey?(
    provider: AssistantProviderId,
    key: string,
    policy?: ApiKeyStoragePolicy
  ): Promise<ApiKeyStorageState | void>;
  getApiKeyStorage?(provider: AssistantProviderId): Promise<ApiKeyStorageState>;
  getState(provider: SubscriptionProvider): Promise<SubscriptionState>;
  signIn(provider: SubscriptionProvider, accountId?: string): Promise<SubscriptionState>;
  cancelSignIn(provider: SubscriptionProvider): Promise<void>;
  selectAccount(provider: SubscriptionProvider, accountId: string): Promise<SubscriptionState>;
  signOut(provider: SubscriptionProvider): Promise<SubscriptionState>;
  manageUsage(provider: SubscriptionProvider): Promise<void>;
  send(id: string, request: SubscriptionChatRequest): Promise<string>;
  cancel(id: string): Promise<void>;
  /** Request-scoped stream; unsubscribe before another account/request can deliver events. */
  onThinking?(id: string, listener: (text: string) => void): () => void;
  onToken?(id: string, listener: (text: string) => void): () => void;
  onUsage?(id: string, listener: (usage: { inputTokens: number; outputTokens: number }) => void): () => void;
  onToolCall?(
    id: string,
    listener: (name: string, input: unknown, callId: string) => Promise<HostToolResult>
  ): () => void;
}
