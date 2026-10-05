/** Public native assistant contract. Credentials and executable paths never cross this boundary. */
export type SubscriptionProvider = 'openai' | 'anthropic';
export type AssistantAuthMode = 'api-key' | 'subscription';

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
  models: { id: string; label: string }[];
  error?: string;
}

export interface SubscriptionChatRequest {
  provider: SubscriptionProvider;
  model: string;
  systemPrompt: string;
  messages: {
    role: 'user' | 'assistant';
    content: string;
    images?: { mimeType: string; data: string }[];
  }[];
  jsonMode?: boolean;
}

export interface AssistantSubscriptionBridge {
  getState(provider: SubscriptionProvider): Promise<SubscriptionState>;
  signIn(provider: SubscriptionProvider, accountId?: string): Promise<SubscriptionState>;
  cancelSignIn(provider: SubscriptionProvider): Promise<void>;
  selectAccount(provider: SubscriptionProvider, accountId: string): Promise<SubscriptionState>;
  signOut(provider: SubscriptionProvider): Promise<SubscriptionState>;
  manageUsage(provider: SubscriptionProvider): Promise<void>;
  send(id: string, request: SubscriptionChatRequest): Promise<string>;
  cancel(id: string): Promise<void>;
}
