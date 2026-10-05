import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAssistantChat } from './index';

const request = {
  settings: {
    provider: 'openai' as const,
    authMode: 'subscription' as const,
    apiKey: 'must-not-leak',
    baseUrl: 'https://attacker.test',
    model: 'model',
  },
  systemPrompt: 'rules',
  messages: [{ role: 'user' as const, content: 'hello' }],
};
describe('subscription provider routing', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends only conversation data to the native runtime and never falls back to API billing', async () => {
    const send = vi.fn(async (_id: string, _request: unknown) => 'reply'),
      fetch = vi.fn();
    vi.stubGlobal('roboBoyDesktop', { assistant: { send, cancel: vi.fn(async () => {}) } });
    vi.stubGlobal('fetch', fetch);
    await expect(sendAssistantChat(request)).resolves.toBe('reply');
    expect(send.mock.calls[0][1]).not.toHaveProperty('apiKey');
    expect(send.mock.calls[0][1]).not.toHaveProperty('baseUrl');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects promptly on cancellation even if the native request has not returned', async () => {
    let finish!: (value: string) => void;
    const send = vi.fn(
      (_id: string, _request: unknown) =>
        new Promise<string>(resolve => {
          finish = resolve;
        })
    );
    const cancel = vi.fn(async () => {});
    vi.stubGlobal('roboBoyDesktop', { assistant: { send, cancel } });
    const controller = new AbortController();
    const result = sendAssistantChat({ ...request, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledWith(send.mock.calls[0][0]);
    finish('late result');
  });
  it('fails explicitly when sign-in is selected on an unsupported platform', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(sendAssistantChat(request)).rejects.toThrow(/Electron desktop/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
