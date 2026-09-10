import { checkedFetch, readSse } from './transport';
import type { SendChat } from './types';

/** Shared by real OpenAI and any local/self-hosted server that speaks the same
 * `/chat/completions` shape (LM Studio, vLLM, llama.cpp server, etc.). */
export const sendChat: SendChat = async ({ settings, systemPrompt, messages, signal, onToken, jsonMode }) => {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const body: Record<string, unknown> = {
    model: settings.model,
    stream: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(turn => {
        const parts = [
          ...(turn.images ?? []).map(image => ({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.data}` },
          })),
          // `input_audio` is the chat-completions shape for a recording. Its `format` is the bare
          // container name, not the MIME type.
          ...(turn.audio ?? []).map(clip => ({
            type: 'input_audio',
            input_audio: { data: clip.data, format: clip.mimeType.includes('mp3') ? 'mp3' : clip.mimeType.includes('wav') ? 'wav' : 'webm' },
          })),
        ];
        return {
          role: turn.role,
          content: parts.length > 0 ? [{ type: 'text', text: turn.content }, ...parts] : turn.content,
        };
      }),
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const response = await checkedFetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  return readSse(response, payload => payload.choices?.[0]?.delta?.content, onToken);
};
