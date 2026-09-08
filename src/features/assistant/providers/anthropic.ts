import { checkedFetch, readSse } from './transport';
import type { SendChat } from './types';

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic's Messages API has no `response_format`/JSON-mode flag, unlike OpenAI/Gemini/Ollama.
 * We approximate it with an explicit instruction — honest about the limitation rather than
 * pretending a native flag exists.
 */
const JSON_MODE_INSTRUCTION =
  '\n\nRespond with ONLY a single valid JSON object matching the schema above. No prose, no markdown code fences.';

export const sendChat: SendChat = async ({ settings, systemPrompt, messages, signal, onToken, jsonMode }) => {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/messages`;
  const response = await checkedFetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Robo-Boy has no application-server proxy for Anthropic (see docs/ai-assistant.md); this
      // header is required for a direct, user-supplied-key call from a browser/webview.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      stream: true,
      temperature: 0.2,
      system: jsonMode ? `${systemPrompt}${JSON_MODE_INSTRUCTION}` : systemPrompt,
      messages: messages.map(turn => ({
        role: turn.role,
        content:
          turn.images && turn.images.length > 0
            ? [
                { type: 'text', text: turn.content },
                ...turn.images.map(image => ({
                  type: 'image',
                  source: { type: 'base64', media_type: image.mimeType, data: image.data },
                })),
              ]
            : turn.content,
      })),
    }),
  });

  return readSse(
    response,
    payload =>
      payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta' ? payload.delta.text : undefined,
    onToken
  );
};
