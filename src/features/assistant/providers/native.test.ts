// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream, type LanguageModel, type ModelMessage } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { SendChatRequest } from './types';

const adapters = vi.hoisted(() => ({
  model: undefined as unknown as LanguageModel,
  openai: vi.fn(),
  anthropic: vi.fn(),
  google: vi.fn(),
  compatible: vi.fn(),
  ollama: vi.fn(),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: (options: unknown) => {
    adapters.openai(options);
    return { responses: () => adapters.model };
  },
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (options: unknown) => {
    adapters.anthropic(options);
    return () => adapters.model;
  },
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: (options: unknown) => {
    adapters.google(options);
    return () => adapters.model;
  },
}));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (options: unknown) => {
    adapters.compatible(options);
    return { chatModel: () => adapters.model };
  },
}));
vi.mock('ollama-ai-provider-v2', () => ({
  createOllama: (options: unknown) => {
    adapters.ollama(options);
    return () => adapters.model;
  },
}));
import { compactNativeMessages, nativeMessages, nativeModel, sendNativeChat } from './native';

const finish = (reason: 'stop' | 'tool-calls' | 'length' = 'stop'): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified: reason, raw: reason },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 5, reasoning: 5 },
  },
});
const stream = (parts: LanguageModelV4StreamPart[]) => ({
  stream: simulateReadableStream({
    chunks: [{ type: 'stream-start', warnings: [] } as LanguageModelV4StreamPart, ...parts],
    initialDelayInMs: 0,
    chunkDelayInMs: 0,
  }),
});
const request = (): SendChatRequest => ({
  settings: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-fixture', model: 'gpt-4.1' },
  systemPrompt: 'Read evidence, then answer.',
  messages: [{ role: 'user', content: 'Read current joints.' }],
  signal: new AbortController().signal,
  tools: {
    definitions: [
      {
        name: 'read_topic',
        description: 'Read joints',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    ],
    execute: vi.fn(async () => ({ ok: true, value: { measuredJoint: 1.2 } })),
  },
});

describe('native multi-provider agent runtime', () => {
  beforeEach(() => vi.clearAllMocks());
  it('replays paired native tool results and reasoning metadata, without additional user turns', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: 'reasoning-start', id: 'r' },
          {
            type: 'reasoning-delta',
            id: 'r',
            delta: 'Checking measured joints.',
            providerMetadata: { test: { signature: 'retain' } },
          },
          { type: 'reasoning-end', id: 'r' },
          { type: 'tool-call', toolCallId: 'joints-call', toolName: 'read_topic', input: '{"name":"/joint_states"}' },
          finish('tool-calls'),
        ]),
        stream([
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'Measured joint is 1.2.' },
          { type: 'text-end', id: 'answer' },
          finish(),
        ]),
      ],
    });
    adapters.model = model;
    const input = {
      ...request(),
      onToken: vi.fn(),
      onThinking: vi.fn(),
      refreshSystemPrompt: vi.fn(() => 'Current refreshed workspace'),
    };
    await expect(sendNativeChat(input)).resolves.toBe('Measured joint is 1.2.');
    expect(input.tools!.execute).toHaveBeenCalledWith('read_topic', { name: '/joint_states' }, 'joints-call');
    expect(input.onThinking).toHaveBeenCalledWith('Checking measured joints.');
    expect(input.onToken).toHaveBeenCalledWith('Measured joint is 1.2.');
    const prompt = model.doStreamCalls[1].prompt;
    expect(prompt.filter(message => message.role === 'user')).toHaveLength(1);
    expect(JSON.stringify(prompt)).toContain('measuredJoint');
    expect(JSON.stringify(prompt)).toContain('joints-call');
    expect(JSON.stringify(prompt)).toContain('retain');
    expect(prompt[0]).toMatchObject({ role: 'system', content: 'Current refreshed workspace' });
  });
  it('returns host validation errors to the model for repair', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: 'tool-call', toolCallId: 'read', toolName: 'read_topic', input: '{"name":"/missing"}' },
          finish('tool-calls'),
        ]),
        stream([
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'That topic is unavailable.' },
          { type: 'text-end', id: 'a' },
          finish(),
        ]),
      ],
    });
    adapters.model = model;
    const input = request();
    input.tools!.execute = vi.fn(async () => ({ ok: false, error: 'Unknown topic.' }));
    await sendNativeChat(input);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Unknown topic.');
  });
  it('returns camera images in tool output rather than synthetic user attachments', async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        stream([
          { type: 'tool-call', toolCallId: 'camera', toolName: 'read_topic', input: '{"name":"/image"}' },
          finish('tool-calls'),
        ]),
        stream([finish()]),
      ],
    });
    adapters.model = model;
    const input = request();
    input.tools!.execute = vi.fn(async () => ({
      ok: true,
      value: 'frame',
      image: { mimeType: 'image/png', data: 'AA==' },
    }));
    await sendNativeChat(input);
    expect(model.doStreamCalls[1].prompt.filter(message => message.role === 'user')).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('image/png');
  });
  it('rejects provider errors, exhausted output and unbounded tool loops', async () => {
    adapters.model = new MockLanguageModelV4({ doStream: stream([{ type: 'error', error: new Error('Offline.') }]) });
    await expect(sendNativeChat(request())).rejects.toThrow('Offline.');
    adapters.model = new MockLanguageModelV4({ doStream: stream([finish('length')]) });
    await expect(sendNativeChat(request())).rejects.toThrow(/output budget/);
    adapters.model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve(
          stream([
            {
              type: 'tool-call',
              toolCallId: crypto.randomUUID(),
              toolName: 'read_topic',
              input: '{"name":"/joint_states"}',
            },
            finish('tool-calls'),
          ])
        ),
    });
    await expect(sendNativeChat(request())).rejects.toThrow(/step allowance/);
  });
  it.each(['openai', 'anthropic', 'gemini', 'openai-compatible', 'ollama'] as const)(
    'uses the installed native %s adapter',
    provider => {
      adapters.model = new MockLanguageModelV4();
      expect(nativeModel({ ...request().settings, provider })).toBe(adapters.model);
    }
  );
  it('normalizes Ollama endpoints and omits empty optional API keys', () => {
    nativeModel({ ...request().settings, provider: 'ollama', baseUrl: 'http://localhost:11434/v1/', apiKey: '' });
    expect(adapters.ollama).toHaveBeenLastCalledWith({ baseURL: 'http://localhost:11434/api', headers: {} });
    nativeModel({ ...request().settings, provider: 'openai-compatible', apiKey: '' });
    expect(adapters.compatible).toHaveBeenCalledWith(expect.objectContaining({ apiKey: undefined }));
  });
  it('bounds history and preserves the original current user message and images', () => {
    const turns = nativeMessages([
      { role: 'user', content: 'old'.repeat(50_000) },
      { role: 'assistant', content: 'Recent reply' },
      { role: 'user', content: 'Now', images: [{ mimeType: 'image/png', data: 'AA==' }] },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Now' },
        { type: 'image', mediaType: 'image/png' },
      ],
    });
    expect(() => nativeMessages([{ role: 'user', content: 'x'.repeat(121_000) }])).toThrow(/120 KiB/);
  });
  it('compacts whole native call/result groups, keeping the last group intact', () => {
    const initial: ModelMessage[] = [{ role: 'user', content: 'Request' }];
    const groups: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'old', toolName: 'x', input: {} }] },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'old', toolName: 'x', output: { type: 'text', value: 'x'.repeat(1000) } },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'new', toolName: 'x', input: {} }] },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'new', toolName: 'x', output: { type: 'text', value: 'latest' } }],
      },
    ];
    const compacted = compactNativeMessages(initial, groups, 600);
    expect(JSON.stringify(compacted)).not.toContain('"old"');
    expect(JSON.stringify(compacted).match(/"new"/g)).toHaveLength(2);
    expect(() => compactNativeMessages(initial, groups, 20)).toThrow(/context budget/);
  });
});
