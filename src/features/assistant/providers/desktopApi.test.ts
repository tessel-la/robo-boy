import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendDesktopApi } from './desktopApi';
import type { SendChatRequest } from './types';

const request = (): SendChatRequest => ({
  settings: { provider: 'openai', model: 'fixture', apiKey: 'renderer-secret', baseUrl: 'https://api.openai.com/v1' },
  systemPrompt: 'Original prompt',
  messages: [{ role: 'user', content: 'Inspect workspace' }],
  tools: {
    definitions: [{ name: 'read_workspace', description: 'Read', inputSchema: { type: 'object' } }],
    execute: vi.fn(async () => ({ ok: true, value: 'observed' })),
    checkpoint: vi.fn(),
  },
});
afterEach(() => vi.unstubAllGlobals());
describe('native desktop API boundary', () => {
  it('routes tokens, thinking, usage and scoped tools without renderer credentials', async () => {
    const cleanup = vi.fn();
    let tool!: (name: string, input: unknown, id: string) => Promise<unknown>;
    const sendApi = vi.fn(async (_id, payload) => {
      expect(payload).not.toHaveProperty('apiKey');
      expect(payload.toolNames).toEqual(['read_workspace']);
      expect(await tool('__step', {}, 'boundary')).toEqual({ ok: true, value: { systemPrompt: 'Fresh prompt' } });
      expect(await tool('read_workspace', {}, 'read')).toEqual({ ok: true, value: 'observed', yieldRequested: true });
      return 'Done';
    });
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        sendApi,
        cancel: vi.fn(),
        onToolCall: (_id: string, callback: typeof tool) => {
          tool = callback;
          return cleanup;
        },
        onToken: (_id: string, callback: (text: string) => void) => {
          callback('Answer');
          return cleanup;
        },
        onThinking: (_id: string, callback: (text: string) => void) => {
          callback('Thinking');
          return cleanup;
        },
        onUsage: (_id: string, callback: (usage: unknown) => void) => {
          callback({ inputTokens: 2, outputTokens: 3 });
          return cleanup;
        },
      },
    });
    const input = {
      ...request(),
      onToken: vi.fn(),
      onThinking: vi.fn(),
      onUsage: vi.fn(),
      beforeStep: vi.fn(),
      shouldYield: () => true,
      refreshSystemPrompt: () => 'Fresh prompt',
    };
    await expect(sendDesktopApi(input)).resolves.toBe('Done');
    expect(input.beforeStep).toHaveBeenCalledOnce();
    expect(input.tools!.checkpoint).toHaveBeenCalledOnce();
    expect(input.tools!.execute).toHaveBeenCalledWith('read_workspace', {}, 'read');
    expect(input.onToken).toHaveBeenCalledWith('Answer');
    expect(input.onThinking).toHaveBeenCalledWith('Thinking');
    expect(input.onUsage).toHaveBeenCalledWith({ inputTokens: 2, outputTokens: 3 });
    expect(cleanup).toHaveBeenCalledTimes(4);
  });
  it('cancels promptly, suppresses late stream events and cleans listeners', async () => {
    const cancel = vi.fn(async () => {}),
      cleanup = vi.fn();
    let token!: (text: string) => void;
    let done!: (value: string) => void;
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        cancel,
        sendApi: () =>
          new Promise<string>(resolve => {
            done = resolve;
          }),
        onToolCall: () => cleanup,
        onToken: (_id: string, callback: typeof token) => {
          token = callback;
          return cleanup;
        },
      },
    });
    const controller = new AbortController(),
      onToken = vi.fn();
    const result = sendDesktopApi({ ...request(), signal: controller.signal, onToken });
    controller.abort();
    token('late');
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(onToken).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledTimes(2);
    done('late answer');
  });
  it('fails explicitly on unavailable runtimes, aborted requests and native errors', async () => {
    await expect(sendDesktopApi(request())).rejects.toThrow('does not support');
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        onToolCall: () => vi.fn(),
        sendApi: vi.fn(async () => {
          throw new Error('Native failure');
        }),
        cancel: vi.fn(),
      },
    });
    await expect(sendDesktopApi(request())).rejects.toThrow('Native failure');
    const controller = new AbortController();
    controller.abort();
    await expect(sendDesktopApi({ ...request(), signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
