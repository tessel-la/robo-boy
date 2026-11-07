import { checkedFetch, readSse } from './transport';
import type { SendChat } from './types';
import { selectedThinkingEffort } from './thinking';

/** Shared by real OpenAI and any local/self-hosted server that speaks the same
 * `/chat/completions` shape (LM Studio, vLLM, llama.cpp server, etc.). */
export const sendChat: SendChat = async ({ settings, systemPrompt, messages, signal, onToken, onThinking, jsonMode }) => {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    ...(settings.provider === 'openai' && /^(?:gpt-[56](?:[.-]|$)|o[134](?:-|$))/.test(settings.model) ? {} : { temperature: 0.2 }),
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(turn => ({
        role: turn.role,
        content:
          turn.images && turn.images.length > 0
            ? [
                { type: 'text', text: turn.content },
                ...turn.images.map(image => ({
                  type: 'image_url',
                  image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                })),
              ]
            : turn.content,
      })),
    ],
  };
  const effort = selectedThinkingEffort(settings.provider, settings.model, settings.thinkingEffort);
  if (effort) body.reasoning_effort = effort;
  if (jsonMode) body.response_format = { type: 'json_object' };

  const response = await checkedFetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  return readSse(response, payload => {
    const delta = payload.choices?.[0]?.delta;
    const thinking = delta?.reasoning_content ?? delta?.reasoning;
    if (typeof thinking === 'string') onThinking?.(thinking);
    return delta?.content;
  }, onToken);
};
