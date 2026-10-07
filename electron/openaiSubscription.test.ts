// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { completedResponse, oauthCallback, OpenAiSubscription } from './openaiSubscription';

const electron = vi.hoisted(() => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
    encryptString: (text: string) => Buffer.from(Buffer.from(text).toString('base64')),
    decryptString: (data: Buffer) => Buffer.from(data.toString(), 'base64').toString(),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('electron', () => electron);

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stream = (...events: unknown[]) =>
  new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));

describe('completed Responses stream', () => {
  it('streams reasoning summaries without including them in the answer', async () => {
    const onThinking = vi.fn();
    const result = await completedResponse(stream(
      { type: 'response.reasoning_summary_text.delta', delta: 'Checking robot data.' },
      { type: 'response.output_text.delta', delta: '{"kind":"explanation","message":"Done"}' },
      { type: 'response.completed', response: { status: 'completed' } }
    ), new AbortController().signal, onThinking);
    expect(onThinking).toHaveBeenCalledWith('Checking robot data.');
    expect(result).not.toContain('Checking robot data.');
  });
  it('requires completion and preserves UTF-8 text split across bytes', async () => {
    const bytes = new TextEncoder().encode(
      'data: {"type":"response.output_text.delta","delta":"hé"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
    );
    const body = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    await expect(completedResponse(new Response(body), new AbortController().signal)).resolves.toBe('hé');
  });
  it.each(['response.failed', 'response.incomplete', 'error'])('rejects %s after partial text', async type => {
    await expect(
      completedResponse(
        stream({ type: 'response.output_text.delta', delta: 'partial' }, { type }),
        new AbortController().signal
      )
    ).rejects.toThrow(/did not complete/);
  });
  it('rejects EOF without completion', async () => {
    await expect(
      completedResponse(stream({ type: 'response.output_text.delta', delta: 'partial' }), new AbortController().signal)
    ).rejects.toThrow(/without a completed/);
  });
});

describe('loopback callback', () => {
  it('ignores invalid state and path, then closes after the correct callback', async () => {
    const callback = await oauthCallback('expected', new AbortController().signal);
    try {
      expect((await fetch(callback.redirectUri + '?state=wrong')).status).toBe(400);
      expect((await fetch(callback.redirectUri.replace('/auth/callback', '/other') + '?state=expected')).status).toBe(
        404
      );
      const confirmation = await fetch(callback.redirectUri + '?state=expected&code=code&client_id=issued');
      expect(await confirmation.text()).toBe('You can return to Robo-Boy.');
      expect(confirmation.headers.get('cache-control')).toBe('no-store');
      expect((await callback.result).get('code')).toBe('code');
    } finally {
      callback.close();
    }
  });
  it('cancels without leaving a listener open', async () => {
    const controller = new AbortController();
    const callback = await oauthCallback('expected', controller.signal);
    controller.abort();
    await expect(callback.result).rejects.toThrow(/cancelled/);
    await expect(fetch(callback.redirectUri)).rejects.toThrow();
  });
});

describe('ChatGPT account lifecycle', () => {
  let directory: string, runtime: OpenAiSubscription;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let publicJwk: any;
  let nonce: string, refreshes: number, lastRequest: any;
  let identitySubject: string, identityAudience: string, grantedScope: string, wrongNonce: boolean;
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(true);
    directory = await mkdtemp(join(tmpdir(), 'roboboy-oauth-test-'));
    runtime = new OpenAiSubscription(directory);
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = { ...(await exportJWK(keys.publicKey)), alg: 'RS256', kid: 'test' };
    nonce = '';
    refreshes = 0;
    identitySubject = 'user-1';
    identityAudience = 'oaiapp_test';
    grantedScope = 'chatgpt.tokens.use.direct';
    wrongNonce = false;
    electron.shell.openExternal.mockImplementation(async (value: string) => {
      const url = new URL(value);
      nonce = url.searchParams.get('nonce')!;
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const callback = new URL(url.searchParams.get('redirect_uri')!);
      callback.search = new URLSearchParams({
        state: url.searchParams.get('state')!,
        code: 'test-code',
        client_id: 'oaiapp_test',
      }).toString();
      await realFetch(callback);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (value: any, init?: RequestInit) => {
        const url = String(value);
        if (url.includes('openid-configuration'))
          return response({
            issuer: 'https://auth.openai.com',
            jwks_uri: 'https://auth.openai.com/jwks',
            revocation_endpoint: 'https://auth.openai.com/revoke',
          });
        if (url.endsWith('/jwks')) return response({ keys: [publicJwk] });
        if (url.endsWith('/oauth/token')) {
          const params = init?.body as URLSearchParams;
          const refreshing = params.get('grant_type') === 'refresh_token';
          if (refreshing) refreshes++;
          const id = await new SignJWT({ nonce: wrongNonce ? 'wrong-nonce' : nonce, email: 'person@example.test' })
            .setProtectedHeader({ alg: 'RS256', kid: 'test' })
            .setIssuer('https://auth.openai.com')
            .setAudience(identityAudience)
            .setSubject(identitySubject)
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(privateKey);
          return response({
            access_token: 'secret-access',
            refresh_token: `secret-refresh-${refreshes}`,
            id_token: id,
            token_type: 'Bearer',
            expires_in: refreshing ? 3600 : 1,
            scope: grantedScope,
          });
        }
        if (url.endsWith('/models'))
          return response({
            models: [
              { slug: 'model', display_name: 'Model', visibility: 'list' },
              { slug: 'hidden', visibility: 'hide' },
            ],
          });
        if (url.endsWith('/responses')) {
          lastRequest = JSON.parse(String(init?.body));
          return stream(
            { type: 'response.output_text.delta', delta: '{"kind":"explanation","message":"ok"}' },
            { type: 'response.completed', response: { status: 'completed' } }
          );
        }
        if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
        throw new Error(`Unexpected test route ${url}`);
      })
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it('signs in, encrypts credentials, refreshes once across concurrent reads, and uses Responses', async () => {
    await runtime.signIn(undefined, new AbortController().signal);
    const [state] = await Promise.all([runtime.getState(), runtime.getState()]);
    expect(state.models).toEqual([{ id: 'model', label: 'Model' }]);
    expect(refreshes).toBe(1);
    expect(JSON.stringify(state)).not.toContain('secret-');
    expect((await readFile(join(directory, 'accounts.bin'))).toString()).not.toContain('secret-access');
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, 'accounts.bin'))).mode & 0o777).toBe(0o600);
    }
    expect((await new OpenAiSubscription(directory).getState()).accounts[0].connected).toBe(true);
    const result = await runtime.send(
      {
        provider: 'openai',
        model: 'model',
        systemPrompt: 'rules',
        jsonMode: true,
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'reply' },
          { role: 'user', content: 'next', images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }] },
        ],
      },
      new AbortController().signal
    );
    expect(result).toContain('explanation');
    expect(lastRequest).toMatchObject({ store: false, stream: true, model: 'model' });
    expect(lastRequest).not.toHaveProperty('temperature');
    expect(lastRequest).not.toHaveProperty('messages');
    expect(lastRequest.input[1]).toEqual({ role: 'assistant', content: 'reply' });
    expect(lastRequest.input[2].content[1].type).toBe('input_image');
    await runtime.signOut();
    expect((await runtime.getState()).accounts[0].connected).toBe(false);
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('rejects a signed ID token intended for a different client', async () => {
    identityAudience = 'other-client';
    await expect(runtime.signIn(undefined, new AbortController().signal)).rejects.toThrow(/aud/);
    expect((await runtime.getState()).accounts[0].connected).toBe(false);
  });
  it('passes selected thinking effort through Responses and leaves default requests unconfigured', async () => {
    await runtime.signIn(undefined, new AbortController().signal);
    await runtime.send(
      {
        provider: 'openai',
        model: 'gpt-6.1-sol',
        thinkingEffort: 'high',
        systemPrompt: '',
        messages: [{ role: 'user', content: 'hello' }],
      },
      new AbortController().signal
    );
    expect(lastRequest.reasoning).toEqual({ effort: 'high', summary: 'auto' });
    await runtime.send(
      { provider: 'openai', model: 'gpt-6.1-sol', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }] },
      new AbortController().signal
    );
    expect(lastRequest.reasoning).toEqual({ summary: 'auto' });
  });
  it('does not treat identity-only consent as plan access', async () => {
    grantedScope = 'openid email';
    await runtime.signIn(undefined, new AbortController().signal);
    expect((await runtime.getState()).accounts[0]).toMatchObject({ connected: true, planEnabled: false });
    await expect(
      runtime.send(
        { provider: 'openai', model: 'model', systemPrompt: '', messages: [{ role: 'user', content: 'hello' }] },
        new AbortController().signal
      )
    ).rejects.toThrow(/allow plan usage/);
  });
  it('rejects a different identity when reconnecting a saved account', async () => {
    await runtime.signIn(undefined, new AbortController().signal);
    const id = (await runtime.getState()).activeAccountId!;
    identitySubject = 'other-user';
    await expect(runtime.signIn(id, new AbortController().signal)).rejects.toThrow(/selected ChatGPT account/);
  });
  it('rejects an ID token with the wrong login nonce', async () => {
    wrongNonce = true;
    await expect(runtime.signIn(undefined, new AbortController().signal)).rejects.toThrow(/identity validation/);
    expect((await runtime.getState()).accounts[0].connected).toBe(false);
  });
  it('does not activate credentials when atomic persistence fails', async () => {
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (value, init) => {
      const reply = await original(value, init);
      if (String(value).endsWith('/oauth/token')) {
        await rm(join(directory, 'accounts.bin'));
        await mkdir(join(directory, 'accounts.bin'));
      }
      return reply;
    });
    await expect(runtime.signIn(undefined, new AbortController().signal)).rejects.toThrow();
    const state = await runtime.getState();
    expect(state.activeAccountId).toBeUndefined();
    expect(state.accounts[0].connected).toBe(false);
  });
  it('clears the local session even when remote revocation fails', async () => {
    await runtime.signIn(undefined, new AbortController().signal);
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((value, init) =>
      String(value).endsWith('/revoke') ? Promise.resolve(new Response(null, { status: 503 })) : original(value, init)
    );
    await expect(runtime.signOut()).rejects.toThrow(/Signed out locally/);
    expect((await runtime.getState()).accounts[0].connected).toBe(false);
    expect((await new OpenAiSubscription(directory).getState()).accounts[0].connected).toBe(false);
  });
  it('refuses insecure OS credential storage', async () => {
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(runtime.signIn(undefined, new AbortController().signal)).rejects.toThrow(/OS credential store/);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });
});
