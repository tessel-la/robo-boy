import { blobToBase64, checkedFetch } from './transport';
import type { AssistantProviderSettings } from './types';

/** Fallback audio-to-text path used only when the browser's Web Speech API is unavailable
 * (see AssistantSpeechTextarea). Ollama has no transcription endpoint. */
export const transcribeAssistantAudio = async (
  audio: Blob,
  settings: AssistantProviderSettings,
  signal?: AbortSignal
): Promise<string> => {
  if (!settings.baseUrl.trim()) {
    throw new Error('Set a base URL before using voice input.');
  }
  if (settings.provider === 'ollama') {
    throw new Error('Ollama does not provide an audio transcription endpoint. Use browser voice recognition instead.');
  }
  if (settings.provider !== 'openai-compatible' && !settings.apiKey.trim()) {
    throw new Error(`Add an API key for ${settings.provider} before using voice input.`);
  }

  if (settings.provider === 'gemini') {
    const url = `${settings.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(settings.model)}:generateContent`;
    const response = await checkedFetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Transcribe this audio exactly. Return only the transcript without commentary.' },
              { inlineData: { mimeType: audio.type || 'audio/webm', data: await blobToBase64(audio) } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    const payload = await response.json();
    const transcript = payload.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text ?? '')
      .join('')
      .trim();
    if (!transcript) throw new Error('The speech model returned an empty transcript.');
    return transcript;
  }

  if (settings.provider === 'anthropic') {
    throw new Error('Anthropic does not provide an audio transcription endpoint. Use browser voice recognition instead.');
  }

  const form = new FormData();
  const extension = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'm4a' : 'webm';
  form.append('file', audio, `instruction.${extension}`);
  form.append('model', settings.provider === 'openai' ? 'gpt-4o-mini-transcribe' : 'whisper-1');
  const headers: Record<string, string> = {};
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const response = await checkedFetch(`${settings.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    signal,
    headers,
    body: form,
  });
  const payload = await response.json();
  const transcript = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!transcript) throw new Error('The speech model returned an empty transcript.');
  return transcript;
};
