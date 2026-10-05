import { safeStorage, shell } from 'electron';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { SubscriptionChatRequest, SubscriptionState } from '../src/runtime/assistantSubscription';

const AUTH = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;

interface Tokens {
  access: string;
  refresh: string;
  id: string;
  expiresAt: number;
  scopes: string[];
}
interface Account {
  id: string;
  clientId: string;
  subject?: string;
  label: string;
  tokens?: Tokens;
}
interface SavedState {
  version: 1;
  hostId: string;
  activeAccountId?: string;
  accounts: Account[];
}

/** Fail closed on damaged credential records rather than treating them as sessions. */
function isSavedState(value: any): value is SavedState {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.hostId !== 'string' ||
    !/^urn:uuid:[a-f0-9-]{36}$/.test(value.hostId) ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > 32
  )
    return false;
  const ids = new Set<string>();
  for (const account of value.accounts) {
    if (
      !account ||
      typeof account.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(account.id) ||
      ids.has(account.id) ||
      typeof account.clientId !== 'string' ||
      !account.clientId ||
      account.clientId.length > 256 ||
      typeof account.label !== 'string' ||
      (account.subject !== undefined && typeof account.subject !== 'string')
    )
      return false;
    ids.add(account.id);
    const tokens = account.tokens;
    if (
      tokens !== undefined &&
      (!tokens ||
        !account.subject ||
        typeof tokens.access !== 'string' ||
        !tokens.access ||
        typeof tokens.refresh !== 'string' ||
        !tokens.refresh ||
        typeof tokens.id !== 'string' ||
        !Number.isFinite(tokens.expiresAt) ||
        !Array.isArray(tokens.scopes) ||
        !tokens.scopes.every((scope: unknown) => typeof scope === 'string'))
    )
      return false;
  }
  return value.activeAccountId === undefined || ids.has(value.activeAccountId);
}

/** Keeps network error details free of credentials, authorization URLs and server-echoed inputs. */
async function checkedJson(response: Response): Promise<any> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : body.error?.code;
    if (code === 'invalid_grant')
      throw new Error('Sign in to ChatGPT again: the saved session has expired or was revoked.');
    if (response.status === 401) throw new Error('Sign in to ChatGPT again.');
    if (response.status === 429 || response.status === 402 || response.status === 403) {
      throw new Error(
        'ChatGPT plan usage is unavailable or has reached its limit. Check Manage usage and the selected account.'
      );
    }
    throw new Error(`ChatGPT request failed (${response.status}). Try again or reconnect your account.`);
  }
  return body;
}

export function requireSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error(
      'ChatGPT sign-in needs an OS credential store. Unlock or enable your system keyring and restart Robo-Boy. API-key mode is still available.'
    );
  }
}

/** Bind before opening the browser. A bad state/host/path never consumes the pending attempt. */
export async function oauthCallback(
  state: string,
  signal: AbortSignal
): Promise<{
  redirectUri: string;
  result: Promise<URLSearchParams>;
  close: () => void;
}> {
  signal.throwIfAborted();
  let resolve!: (params: URLSearchParams) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<URLSearchParams>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The caller may still be waiting for the system browser when the attempt is cancelled.
  void result.catch(() => {});
  const server = createServer((request, response) => {
    let url: URL;
    try {
      if ((request.url?.length ?? 0) > 8192) throw new Error();
      url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      request.method !== 'GET' ||
      request.headers.host !== `127.0.0.1:${port}` ||
      url.origin !== `http://127.0.0.1:${port}` ||
      url.pathname !== '/auth/callback'
    ) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get('state') !== state) {
      response.writeHead(400).end('Invalid sign-in attempt.');
      return;
    }
    response
      .writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      .end('You can return to Robo-Boy.');
    resolve(url.searchParams);
    close();
  });
  let port = 0;
  await new Promise<void>((yes, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', no);
      yes();
    });
  });
  port = (server.address() as { port: number }).port;
  const cancel = () => {
    reject(new Error('ChatGPT sign-in was cancelled.'));
    close();
  };
  const timeout = setTimeout(() => {
    reject(new Error('ChatGPT sign-in timed out. Please try again.'));
    close();
  }, 300_000);
  function close() {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    server.close();
    server.closeAllConnections();
  }
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  return { redirectUri: `http://127.0.0.1:${port}/auth/callback`, result, close };
}

/** Responses streams are successful only at their completed event, never at EOF or a text delta. */
export async function completedResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.ok) await checkedJson(response);
  if (!response.body) throw new Error('ChatGPT returned no response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    text = '',
    completed = false;
  const consume = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'response.output_text.delta') text += event.delta ?? '';
    if (text.length > 4 * 1024 * 1024) throw new Error('ChatGPT response is too large.');
    if (event.type === 'response.completed') completed = event.response?.status === 'completed';
    if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
      throw new Error('ChatGPT did not complete the response. Check Manage usage or try again.');
    }
  };
  try {
    let ended = false;
    while (!ended) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      blocks.forEach(consume);
      if (buffer.length > 4 * 1024 * 1024) throw new Error('ChatGPT stream event is too large.');
      ended = done;
    }
    if (buffer.trim()) consume(buffer);
    signal.throwIfAborted();
    if (!completed || !text.trim()) throw new Error('ChatGPT stream ended without a completed response. Try again.');
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class OpenAiSubscription {
  private saved?: SavedState;
  private queue: Promise<unknown> = Promise.resolve();
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private directory: string) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  private async load(): Promise<SavedState> {
    if (this.saved) return this.saved;
    try {
      const encrypted = await readFile(join(this.directory, 'accounts.bin'));
      requireSecureStorage();
      const state = JSON.parse(safeStorage.decryptString(encrypted));
      if (!isSavedState(state)) throw new Error();
      return (this.saved = state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Cannot unlock the saved ChatGPT accounts. Unlock your system keyring and restart Robo-Boy.');
      return (this.saved = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] });
    }
  }

  private async save(next: SavedState): Promise<void> {
    requireSecureStorage();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `accounts-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(this.directory, 'accounts.bin'));
      this.saved = next;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async verify(idToken: string, clientId: string, nonce?: string) {
    if (!this.jwks) {
      const metadata = await checkedJson(
        await fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) })
      );
      const url = new URL(metadata.jwks_uri);
      if (metadata.issuer !== AUTH || url.origin !== AUTH)
        throw new Error('Unexpected ChatGPT identity configuration.');
      this.jwks = createRemoteJWKSet(url);
    }
    const { payload } = await jwtVerify(idToken, this.jwks, {
      issuer: AUTH,
      audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if ((nonce !== undefined && payload.nonce !== nonce) || !payload.sub)
      throw new Error('ChatGPT sign-in identity validation failed.');
    return payload;
  }

  private tokens(body: any, previous?: Tokens): Tokens {
    const refresh = body.refresh_token ?? previous?.refresh;
    if (
      typeof body.access_token !== 'string' ||
      typeof refresh !== 'string' ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      body.token_type?.toLowerCase() !== 'bearer'
    ) {
      throw new Error('ChatGPT returned an incomplete session. Please sign in again.');
    }
    return {
      access: body.access_token,
      refresh,
      id: body.id_token ?? previous?.id ?? '',
      expiresAt: Date.now() + body.expires_in * 1000,
      scopes: typeof body.scope === 'string' ? body.scope.split(' ') : (previous?.scopes ?? []),
    };
  }

  async signIn(accountId: string | undefined, signal: AbortSignal): Promise<void> {
    requireSecureStorage();
    const saved = await this.exclusive(() => this.load());
    const existing = accountId ? saved.accounts.find(account => account.id === accountId) : undefined;
    if (accountId && !existing) throw new Error('Choose a saved ChatGPT account.');
    if (!existing && saved.accounts.length >= 32) throw new Error('Too many saved ChatGPT accounts.');
    const state = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const callback = await oauthCallback(state, signal);
    try {
      const url = new URL(`${AUTH}/api/accounts/authorize`);
      url.search = new URLSearchParams({
        client_id: existing?.clientId ?? 'dynamic_agent_client',
        ...(existing ? {} : { agent_name_hint: 'Robo-Boy' }),
        ext_agent_host_id: saved.hostId,
        response_type: 'code',
        redirect_uri: callback.redirectUri,
        scope: SCOPES,
        resource: RESOURCE,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      }).toString();
      await shell.openExternal(url.toString());
      const params = await callback.result;
      signal.throwIfAborted();
      if (params.has('error')) throw new Error('ChatGPT sign-in was declined. You can try again or use API key.');
      const clientId = params.get('client_id') ?? existing?.clientId;
      const code = params.get('code');
      if (
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        clientId.length > 256 ||
        !code ||
        (existing && clientId !== existing.clientId)
      )
        throw new Error('ChatGPT returned an invalid registration.');
      // Keep the issued registration even if code exchange fails; reauthorization reuses it.
      const account: Account = existing ?? {
        id: randomUUID(),
        clientId,
        label: `Connection ${saved.accounts.length + 1}`,
      };
      await this.exclusive(async () => {
        const next = structuredClone(await this.load());
        if (!existing) next.accounts.push(account);
        await this.save(next);
      });
      const body = await checkedJson(
        await fetch(`${AUTH}/api/accounts/oauth/token`, {
          method: 'POST',
          signal,
          redirect: 'error',
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            code_verifier: verifier,
            redirect_uri: callback.redirectUri,
            resource: RESOURCE,
          }),
        })
      );
      const identity = await this.verify(body.id_token, clientId, nonce);
      if (account.subject && account.subject !== identity.sub)
        throw new Error('Sign in with the selected ChatGPT account, or add a new account.');
      signal.throwIfAborted();
      await this.exclusive(async () => {
        signal.throwIfAborted();
        const next = structuredClone(await this.load());
        const updated = next.accounts.find(item => item.id === account.id)!;
        updated.tokens = this.tokens(body);
        updated.subject = identity.sub;
        updated.label = typeof identity.email === 'string' ? identity.email : account.label;
        next.activeAccountId = account.id;
        await this.save(next);
      });
    } finally {
      callback.close();
    }
  }

  async selectAccount(id: string): Promise<void> {
    await this.exclusive(async () => {
      const saved = structuredClone(await this.load());
      if (!saved.accounts.some(account => account.id === id)) throw new Error('Unknown ChatGPT account.');
      saved.activeAccountId = id;
      await this.save(saved);
    });
  }

  private async access(): Promise<string> {
    return this.exclusive(async () => {
      const saved = structuredClone(await this.load());
      const account = saved.accounts.find(account => account.id === saved.activeAccountId);
      if (!account?.tokens) throw new Error('Continue with ChatGPT in Assistant settings before sending.');
      if (!account.tokens.scopes.includes(PLAN_SCOPE))
        throw new Error('Reconnect ChatGPT and allow plan usage before sending.');
      if (account.tokens.expiresAt <= Date.now() + 60_000) {
        try {
          const body = await checkedJson(
            await fetch(`${AUTH}/api/accounts/oauth/token`, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(20_000),
              body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: account.clientId,
                refresh_token: account.tokens.refresh,
                resource: RESOURCE,
              }),
            })
          );
          if (body.id_token && (await this.verify(body.id_token, account.clientId)).sub !== account.subject)
            throw new Error('ChatGPT account changed during renewal.');
          account.tokens = this.tokens(body, account.tokens);
          await this.save(saved);
        } catch (error) {
          if (error instanceof Error && /sign in|account changed/i.test(error.message)) {
            account.tokens = undefined;
            await this.save(saved);
          }
          throw error;
        }
      }
      if (!account.tokens.scopes.includes(PLAN_SCOPE))
        throw new Error('ChatGPT plan permission was revoked. Reconnect your account.');
      return account.tokens.access;
    });
  }

  async getState(): Promise<SubscriptionState> {
    const saved = await this.exclusive(() => this.load());
    const state: SubscriptionState = {
      activeAccountId: saved.activeAccountId,
      models: [],
      accounts: saved.accounts.map(account => ({
        id: account.id,
        label: account.label,
        connected: !!account.tokens,
        planEnabled: !!account.tokens?.scopes.includes(PLAN_SCOPE),
      })),
    };
    if (!state.accounts.some(account => account.id === state.activeAccountId && account.planEnabled)) return state;
    try {
      const access = await this.access();
      const body = await checkedJson(
        await fetch(`${RESOURCE}/models`, {
          headers: { Authorization: `Bearer ${access}` },
          signal: AbortSignal.timeout(20_000),
        })
      );
      if (!Array.isArray(body.models)) throw new Error('ChatGPT returned no model catalog.');
      state.models = body.models
        .filter((model: any) => model.visibility === 'list' && typeof model.slug === 'string')
        .map((model: any) => ({
          id: model.slug,
          label: typeof model.display_name === 'string' ? model.display_name : model.slug,
        }));
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Unable to load ChatGPT models.';
    }
    // Refresh may have invalidated a session. Never report its earlier snapshot as connected.
    const current = await this.exclusive(() => this.load());
    state.activeAccountId = current.activeAccountId;
    state.accounts = current.accounts.map(account => ({
      id: account.id,
      label: account.label,
      connected: !!account.tokens,
      planEnabled: !!account.tokens?.scopes.includes(PLAN_SCOPE),
    }));
    return state;
  }

  async signOut(): Promise<void> {
    await this.exclusive(async () => {
      const saved = structuredClone(await this.load());
      const account = saved.accounts.find(account => account.id === saved.activeAccountId);
      if (!account?.tokens) return;
      let failed = false;
      try {
        const metadata = await checkedJson(
          await fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) })
        );
        const endpoint = new URL(metadata.revocation_endpoint);
        if (endpoint.origin !== AUTH) throw new Error();
        const response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
          body: new URLSearchParams({
            token: account.tokens.refresh,
            token_type_hint: 'refresh_token',
            client_id: account.clientId,
          }),
        });
        failed = !response.ok;
      } catch {
        failed = true;
      }
      account.tokens = undefined;
      await this.save(saved);
      if (failed)
        throw new Error(
          'Signed out locally. Remote revocation could not be confirmed; disconnect Robo-Boy in ChatGPT Settings.'
        );
    });
  }

  async send(request: SubscriptionChatRequest, signal: AbortSignal): Promise<string> {
    const access = await this.access();
    signal.throwIfAborted();
    const response = await fetch(`${RESOURCE}/responses`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        store: false,
        stream: true,
        instructions:
          request.systemPrompt +
          (request.jsonMode ? '\nReturn only one valid JSON object. No markdown or prose outside JSON.' : ''),
        input: request.messages.map(turn => ({
          role: turn.role,
          content:
            turn.role === 'assistant'
              ? turn.content
              : [
                  { type: 'input_text', text: turn.content },
                  ...(turn.images ?? []).map(image => ({
                    type: 'input_image',
                    image_url: `data:${image.mimeType};base64,${image.data}`,
                  })),
                ],
        })),
      }),
    });
    return completedResponse(response, signal);
  }
}
