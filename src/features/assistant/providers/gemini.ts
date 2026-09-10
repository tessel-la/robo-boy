import { checkedFetch, readSse } from './transport';
import type { SendChat } from './types';

export const sendChat: SendChat = async ({ settings, systemPrompt, messages, signal, onToken, jsonMode }) => {
  const url = `${settings.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(settings.model)}:streamGenerateContent?alt=sse`;
  const contents = messages.map(turn => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [
      { text: turn.content },
      ...(turn.images ?? []).map(image => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
      ...(turn.audio ?? []).map(clip => ({ inlineData: { mimeType: clip.mimeType, data: clip.data } })),
    ],
  }));

  const response = await checkedFetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.2,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  });
  return readSse(
    response,
    payload => payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? '').join(''),
    onToken
  );
};
