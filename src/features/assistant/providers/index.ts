import { sendChat as sendOpenAi } from './openai';
import { sendChat as sendGemini } from './gemini';
import { sendChat as sendOllama } from './ollama';
import { sendChat as sendOpenAiCompatible } from './openaiCompatible';
import { sendChat as sendAnthropic } from './anthropic';
import type { AssistantProviderId, SendChat, SendChatRequest } from './types';

const PROVIDERS: Record<AssistantProviderId, SendChat> = {
  openai: sendOpenAi,
  gemini: sendGemini,
  ollama: sendOllama,
  'openai-compatible': sendOpenAiCompatible,
  anthropic: sendAnthropic,
};

export const sendAssistantChat = (request: SendChatRequest): Promise<string> => {
  const provider = PROVIDERS[request.settings.provider];
  if (!provider) throw new Error(`Unknown assistant provider "${request.settings.provider}".`);
  request.onProgress?.(`Contacting ${request.settings.provider} (${request.settings.model})…`);
  return provider(request);
};

export * from './types';
export { fetchOllamaModels } from './ollama';
