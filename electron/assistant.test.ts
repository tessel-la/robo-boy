// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
const native = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  send: vi.fn(),
  state: vi.fn(async () => ({ accounts: [], models: [] })),
  select: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/roboboy-test', once: vi.fn() },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => native.handlers.set(name, handler) },
  shell: { openExternal: vi.fn() },
}));
vi.mock('./openaiSubscription', () => ({
  OpenAiSubscription: class {
    getState = native.state;
    send = native.send;
    selectAccount = native.select;
    signOut = vi.fn();
    signIn = vi.fn();
  },
}));
vi.mock('./claudeSubscription', () => ({
  ClaudeSubscription: class {
    getState = native.state;
    send = native.send;
    signOut = vi.fn();
    signIn = vi.fn();
  },
}));
import { assertAssistantCaller, registerAssistantSubscriptions, validateSubscriptionRequest } from './assistant';

const chat = {
  provider: 'openai',
  model: 'model',
  systemPrompt: 'rules',
  messages: [{ role: 'user', content: 'hello' }],
};
const event = (id = 1, url = 'app://robo-boy/index.html') => {
  const frame = { url };
  return { senderFrame: frame, sender: { id, mainFrame: frame, on: vi.fn(), once: vi.fn() } } as any;
};
describe('native assistant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.handlers.clear();
  });
  it('rejects panel subframes and foreign main frames, including other opaque origins', () => {
    expect(() => assertAssistantCaller(event(), 'app://robo-boy')).not.toThrow();
    expect(() => assertAssistantCaller(event(1, 'app://other/index.html'), 'app://robo-boy')).toThrow(/Untrusted/);
    const child = event();
    child.senderFrame = { url: 'app://robo-boy/index.html' };
    expect(() => assertAssistantCaller(child, 'app://robo-boy')).toThrow(/app window/);
    expect(() => assertAssistantCaller(event(1, 'https://example.test'), 'app://robo-boy')).toThrow();
  });
  it('validates structured input and discards URLs, secrets and executable settings supplied by the renderer', () => {
    expect(
      validateSubscriptionRequest({ ...chat, apiKey: 'secret', baseUrl: 'http://attacker', executable: '/bad' })
    ).toEqual(chat);
    expect(() => validateSubscriptionRequest({ ...chat, provider: 'ollama' })).toThrow();
    expect(() => validateSubscriptionRequest({ ...chat, model: '--bad' })).toThrow();
    expect(() => validateSubscriptionRequest({ ...chat, model: 'gpt-6.1-sol', thinkingEffort: 'ultracode' })).toThrow(
      /thinking/
    );
    expect(() => validateSubscriptionRequest({ ...chat, model: 'gpt-4.1', thinkingEffort: 'high' })).toThrow(
      /thinking/
    );
    expect(validateSubscriptionRequest({ ...chat, model: 'gpt-6.1-sol', thinkingEffort: 'high' })).toHaveProperty(
      'thinkingEffort',
      'high'
    );
    expect(() =>
      validateSubscriptionRequest({ ...chat, messages: [{ role: 'assistant', content: 'reply' }] })
    ).toThrow();
    expect(() =>
      validateSubscriptionRequest({
        ...chat,
        messages: [{ role: 'user', content: '', images: [{ mimeType: 'image/svg+xml', data: 'AA==' }] }],
      })
    ).toThrow();
  });
  it('blocks credential retrieval by untrusted or embedded frames', () => {
    registerAssistantSubscriptions('app://robo-boy');
    const child = event();
    child.senderFrame = { url: 'app://robo-boy/index.html' };
    expect(() => native.handlers.get('roboboy:assistant-api-key')!(child, 'openai')).toThrow(/app window/);
    expect(() =>
      native.handlers.get('roboboy:assistant-save-api-key')!(event(1, 'https://attacker.test'), 'openai', 'key')
    ).toThrow(/Untrusted/);
    expect(() => native.handlers.get('roboboy:assistant-api-key-storage')!(child, 'openai')).toThrow(/app window/);
    expect(() => native.handlers.get('roboboy:assistant-save-api-key')!(event(), 'openai', 'key', 'invalid')).toThrow(
      /policy/
    );
  });
  it('cancels in-flight inference when its account changes and never returns a stale result', async () => {
    registerAssistantSubscriptions('app://robo-boy');
    let finish!: (value: string) => void;
    native.send.mockImplementation(
      () =>
        new Promise<string>(resolve => {
          finish = resolve;
        })
    );
    const pending = native.handlers.get('roboboy:assistant-send')!(event(), 'request-1', chat);
    const failure = expect(pending).rejects.toThrow();
    await native.handlers.get('roboboy:assistant-select-account')!(event(), 'openai', 'account-2');
    expect(native.send.mock.calls[0][1].aborted).toBe(true);
    finish('stale proposal');
    await failure;
  });
  it('allows only the originating window to cancel a request', async () => {
    registerAssistantSubscriptions('app://robo-boy');
    let finish!: (value: string) => void;
    native.send.mockImplementation(
      () =>
        new Promise<string>(resolve => {
          finish = resolve;
        })
    );
    const pending = native.handlers.get('roboboy:assistant-send')!(event(), 'request-1', chat);
    native.handlers.get('roboboy:assistant-cancel')!(event(2), 'request-1');
    expect(native.send.mock.calls[0][1].aborted).toBe(false);
    finish('ok');
    await expect(pending).resolves.toBe('ok');
  });
});
