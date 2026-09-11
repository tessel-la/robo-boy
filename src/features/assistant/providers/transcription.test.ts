import { describe, expect, it, vi, beforeEach } from 'vitest';
import { transcribeAssistantAudio } from './transcription';
import type { AssistantProviderSettings } from './types';

// This is the path voice input actually takes in the packaged Android app, where the webview has no
// Web Speech API and AssistantSpeechTextarea falls back to record-and-transcribe.

const settingsFor = (
  provider: AssistantProviderSettings['provider'],
  overrides: Partial<AssistantProviderSettings> = {}
): AssistantProviderSettings => ({
  provider,
  apiKey: 'test-key',
  baseUrl:
    provider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta/'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/'
        : 'http://localhost:8080/v1',
  model: 'test-model',
  ...overrides,
});

const recording = (type = 'audio/webm') => new Blob([new Uint8Array([1, 2, 3, 4])], { type });

describe('transcribeAssistantAudio', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  const jsonResponse = (payload: unknown) =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('uploads the recording as multipart audio and returns the trimmed transcript', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: '  drive forward  ' }));

    const transcript = await transcribeAssistantAudio(recording(), settingsFor('openai'));

    expect(transcript).toBe('drive forward');
    const [url, init] = fetchMock.mock.calls[0];
    // The trailing slash on the base URL must not become a double slash.
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe');
    expect((form.get('file') as File).name).toBe('instruction.webm');
  });

  it.each([
    ['audio/ogg; codecs=opus', 'instruction.ogg'],
    ['audio/mp4', 'instruction.m4a'],
    ['', 'instruction.webm'],
  ])('names a %s recording %s so the endpoint can decode it', async (mimeType, filename) => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));

    await transcribeAssistantAudio(recording(mimeType), settingsFor('openai'));

    expect(((fetchMock.mock.calls[0][1].body as FormData).get('file') as File).name).toBe(filename);
  });

  it('asks a self-hosted OpenAI-compatible endpoint for whisper-1, with no key required', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));

    await transcribeAssistantAudio(recording(), settingsFor('openai-compatible', { apiKey: '' }));

    const [, init] = fetchMock.mock.calls[0];
    expect((init.body as FormData).get('model')).toBe('whisper-1');
    expect(init.headers).toEqual({});
  });

  it('sends Gemini the audio inline as base64 and joins its returned parts', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: 'drive ' }, { text: 'forward' }] } }] })
    );

    const transcript = await transcribeAssistantAudio(recording(), settingsFor('gemini'));

    expect(transcript).toBe('drive forward');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const parts = JSON.parse(init.body as string).contents[0].parts;
    expect(parts[1].inlineData).toEqual({ mimeType: 'audio/webm', data: 'AQIDBA==' });
  });

  it.each([
    ['ollama', 'Ollama does not provide an audio transcription endpoint. Use browser voice recognition instead.'],
    ['anthropic', 'Anthropic does not provide an audio transcription endpoint. Use browser voice recognition instead.'],
  ] as const)('tells the user to use browser recognition for %s rather than failing obscurely', async (provider, message) => {
    await expect(transcribeAssistantAudio(recording(), settingsFor(provider))).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses without a base URL or an API key instead of posting a recording nowhere', async () => {
    await expect(transcribeAssistantAudio(recording(), settingsFor('openai', { baseUrl: '  ' }))).rejects.toThrow(
      'Set a base URL before using voice input.'
    );
    await expect(transcribeAssistantAudio(recording(), settingsFor('openai', { apiKey: '' }))).rejects.toThrow(
      'Add an API key for openai before using voice input.'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', {}],
    ['gemini', { candidates: [{ content: { parts: [{ text: '   ' }] } }] }],
  ] as const)('reports an empty %s transcript rather than appending nothing', async (provider, payload) => {
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(transcribeAssistantAudio(recording(), settingsFor(provider))).rejects.toThrow(
      'The speech model returned an empty transcript.'
    );
  });

  it('surfaces the endpoint status and message when transcription is rejected', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'audio too short' } }), { status: 400, statusText: 'Bad Request' })
    );

    await expect(transcribeAssistantAudio(recording(), settingsFor('openai'))).rejects.toThrow(
      '400 Bad Request: audio too short'
    );
  });

  it('passes the caller\'s abort signal through, so closing the assistant stops the upload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ text: 'ok' }));
    const controller = new AbortController();

    await transcribeAssistantAudio(recording(), settingsFor('openai'), controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
