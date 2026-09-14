import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sendAssistantChat } from './index';
import type { AssistantProviderSettings } from './types';

const sseBody = (chunks: string[]) =>
  new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(new TextEncoder().encode(chunk)));
      controller.close();
    },
  });

const ndjsonBody = (lines: string[]) =>
  new ReadableStream({
    start(controller) {
      lines.forEach(line => controller.enqueue(new TextEncoder().encode(`${line}\n`)));
      controller.close();
    },
  });

const settingsFor = (provider: AssistantProviderSettings['provider']): AssistantProviderSettings => ({
  provider,
  apiKey: 'test-key',
  baseUrl:
    provider === 'openai'
      ? 'https://api.openai.com/v1'
      : provider === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : provider === 'anthropic'
          ? 'https://api.anthropic.com/v1'
          : provider === 'ollama'
            ? '/ollama'
            : 'http://localhost:11434/v1',
  model: 'test-model',
});

describe('sendAssistantChat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends a real multi-turn messages array (not a flattened string) to OpenAI-compatible providers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: sseBody(['data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: [DONE]\n\n']),
    });

    const result = await sendAssistantChat({
      settings: settingsFor('openai'),
      systemPrompt: 'You are helpful.',
      messages: [
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'ack' },
        { role: 'user', content: 'second turn' },
      ],
      jsonMode: true,
    });

    expect(result).toBe('Hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'first turn' },
      { role: 'assistant', content: 'ack' },
      { role: 'user', content: 'second turn' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(init.headers.Authorization).toBe('Bearer test-key');
  });

  it('maps roles for Gemini (assistant -> model) and uses systemInstruction, not a system message', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: sseBody(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']),
    });

    await sendAssistantChat({
      settings: settingsFor('gemini'),
      systemPrompt: 'System rules.',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(':streamGenerateContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(init.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'System rules.' }] });
    expect(body.contents.map((entry: any) => entry.role)).toEqual(['user', 'model']);
  });

  it('sends Ollama chat requests as NDJSON with a native system message', async () => {
    fetchMock.mockResolvedValue({ ok: true, body: ndjsonBody(['{"message":{"content":"Hi"}}', '{"message":{"content":"!"}}']) });

    const result = await sendAssistantChat({
      settings: settingsFor('ollama'),
      systemPrompt: 'Be terse.',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toBe('Hi!');
    const [url, init] = fetchMock.mock.calls[0];
    // The client requests /ollama/api/chat; Caddy's same-origin proxy strips the /ollama prefix
    // and forwards /api/chat to the real Ollama server (infra/caddy/Caddyfile) — unchanged from
    // the previous BT-agent client.
    expect(url).toBe('/ollama/api/chat');
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be terse.' });
  });

  it('sends Anthropic requests with the direct-browser-access header, x-api-key, and top-level system field', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: sseBody(['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n']),
    });

    const result = await sendAssistantChat({
      settings: settingsFor('anthropic'),
      systemPrompt: 'Robo-Boy persona.',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toBe('Hi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('test-key');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(init.headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(init.body);
    expect(body.system).toBe('Robo-Boy persona.');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('approximates JSON mode for Anthropic via a system-prompt instruction, since it has no response_format flag', async () => {
    fetchMock.mockResolvedValue({ ok: true, body: sseBody([]) });
    await sendAssistantChat({ settings: settingsFor('anthropic'), systemPrompt: 'Base.', messages: [{ role: 'user', content: 'x' }], jsonMode: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.system).toContain('Base.');
    expect(body.system).toMatch(/valid JSON object/i);
  });

  it('surfaces a provider HTTP error with status and message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: { message: 'invalid api key' } }),
    });
    await expect(
      sendAssistantChat({ settings: settingsFor('openai'), systemPrompt: '', messages: [{ role: 'user', content: 'x' }] })
    ).rejects.toThrow(/401.*invalid api key/s);
  });
});
