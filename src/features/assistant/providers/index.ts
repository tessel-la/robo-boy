import { sendChat as sendOpenAi } from './openai';
import { sendChat as sendGemini } from './gemini';
import { sendChat as sendOllama } from './ollama';
import { sendChat as sendOpenAiCompatible } from './openaiCompatible';
import { sendChat as sendAnthropic } from './anthropic';
import { sendSubscriptionChat } from './subscription';
import type { AssistantProviderId, SendChat, SendChatRequest } from './types';
import { getDesktopBridge } from '../../../runtime/desktopBridge';

const PROVIDERS: Record<AssistantProviderId, SendChat> = {
  openai: sendOpenAi,
  gemini: sendGemini,
  ollama: sendOllama,
  'openai-compatible': sendOpenAiCompatible,
  anthropic: sendAnthropic,
};

export const sendAssistantChat = (request: SendChatRequest): Promise<string> => {
  if (request.settings.authMode === 'subscription') return sendSubscriptionChat(request);
  if (request.tools && getDesktopBridge()?.assistant?.sendApi) return import('./desktopApi').then(({ sendDesktopApi }) => sendDesktopApi(request));
  if (request.tools) return import('./native').then(({ sendNativeChat }) => sendNativeChat(request));
  const provider = PROVIDERS[request.settings.provider];
  if (!provider) throw new Error(`Unknown assistant provider "${request.settings.provider}".`);
  request.onProgress?.(`Contacting ${request.settings.provider} (${request.settings.model})…`);
  return provider(request);
};

export * from './types';
export { fetchOllamaModels } from './ollama';
