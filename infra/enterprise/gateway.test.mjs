import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture } from './test/provider.mjs';
import { branding, enabled, secureOrigin } from './config.mjs';
import { createEnterpriseGateway } from './gateway.mjs';

describe('Enterprise configuration', () => {
  it('has no login or custom branding by default and rejects unsafe settings', () => {
    assert.equal(enabled(undefined), false);
    assert.equal(branding().name, 'Robo-Boy');
    for (const value of ['1', 'TRUE', '']) assert.throws(() => enabled(value));
    for (const value of [
      { logo: 'https://tracker.example/logo.png' },
      { logo: '/branding/../secret.svg' },
      { accent: 'red;display:none' },
      { supportUrl: 'javascript:alert(1)' },
      { script: 'alert(1)' },
      { version: 2 },
    ])
      assert.throws(() => branding(value));
    for (const value of [
      'http://robot.example',
      'https://robot.example/other',
      'https://user:secret@robot.example',
      'https://robot.example?secret=one',
    ])
      assert.throws(() => secureOrigin(value));
    assert.equal(branding({ name: 'Company A', accent: '#1765b5' }).name, 'Company A');
  });
});

describe('Enterprise gateway using a signed OIDC issuer', () => {
  let app;
  beforeEach(async () => {
    app = await fixture();
  });
  afterEach(async () => {
    await app.close();
  });
  const post = (app, path, body, extra = {}) =>
    fetch(app.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'tauri://localhost', ...extra },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
  const nativeStart = async app => {
    const secret = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(secret).digest('hex');
    const response = await post(app, '/auth/native/start', { challenge });
    assert.equal(response.status, 200);
    return { ...(await response.json()), secret };
  };
  const stillForwarding = async socket => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ op: 'subscribe', topic: '/image' }));
    return Promise.race([once(socket, 'message').then(() => true), once(socket, 'close').then(() => false)]);
  };
  const nativeSession = async app => {
    const start = await nativeStart(app);
    const login = await app.login(start.id);
    assert.equal(login.result.status, 200);
    const polled = await post(app, '/auth/native/poll', start);
    assert.equal(polled.status, 200);
    return polled.json();
  };

  it('protects backend routes and permits only public frontend assets before login', async () => {
    assert.equal(
      (await fetch(app.url + '/webrtc/camera/whep', { headers: { Authorization: 'Bearer media-gateway-token' } }))
        .status,
      401
    );
    for (const path of [
      '/websocket',
      '/video_stream/stream',
      '/recordings/list',
      '/mesh_resources/model.stl',
      '/api/panels/status',
      '/ollama/api/tags',
      '/webrtc/_discovery/paths',
      '/9090/',
    ])
      assert.equal((await fetch(app.url + path)).status, 401, path);
    for (const path of ['/', '/assets/app.js', '/branding/example.svg', '/panels/installed.json'])
      assert.equal((await fetch(app.url + path)).status, 200, path);
    assert.equal((await fetch(app.url + '/auth/session')).status, 401);
    assert.equal(app.received.length, 4);
  });

  it('issues a secure HttpOnly session after state, nonce, signature, audience and PKCE validation', async () => {
    const { result, cookie } = await app.login();
    assert.equal(result.status, 303);
    assert.match(result.headers.getSetCookie().join(';'), /HttpOnly; SameSite=Lax; Max-Age=3600; Secure/);
    assert.ok(cookie);
    const session = await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } });
    const body = await session.json();
    assert.deepEqual(body.user, { id: 'employee-1', name: 'Alice Employee' });
    assert.equal(body.token, undefined);
    assert.equal(JSON.stringify(body).includes('provider-token'), false);
    const allowed = await fetch(app.url + '/recordings/list', { headers: { Cookie: cookie, 'X-Auth-User': 'Forged' } });
    assert.equal(allowed.status, 200);
    assert.equal(app.received.at(-1).headers.cookie, undefined);
    assert.equal(app.received.at(-1).headers['x-auth-user'], undefined);
    assert.match(app.received.at(-1).headers.host, /^127\.0\.0\.1:/);
    assert.equal(allowed.headers.get('set-cookie'), null);
    assert.equal(allowed.headers.get('cache-control'), 'private, no-store');
  });

  it('rejects a callback without the browser binding and consumes callbacks once', async () => {
    const { callback, browserCookie, cookie } = await app.login();
    assert.ok(cookie);
    const replay = await fetch(app.url + callback.pathname + callback.search, {
      headers: { Cookie: browserCookie },
      redirect: 'manual',
    });
    assert.equal(replay.status, 400);
    const start = await fetch(app.url + '/auth/login', { redirect: 'manual' });
    const authorized = await fetch(start.headers.get('location'), { redirect: 'manual' });
    const address = new URL(authorized.headers.get('location'));
    assert.equal((await fetch(app.url + address.pathname + address.search, { redirect: 'manual' })).status, 400);
  });

  it('rejects signed tokens with the wrong audience, issuer, nonce or expiry', async () => {
    for (const claims of [
      { aud: 'another-client' },
      { iss: 'https://other-issuer.example' },
      { nonce: 'wrong' },
      { exp: 1 },
    ]) {
      app.overrideClaims(claims);
      assert.equal((await app.login()).result.status, 400);
    }
  });

  it('rejects an ID token whose signature does not match the issuer keys', async () => {
    app.invalidateSignature();
    assert.equal((await app.login()).result.status, 400);
    assert.equal((await fetch(app.url + '/auth/session')).status, 401);
  });

  it('rejects an untrusted WebSocket origin even with a valid cookie', async () => {
    const { cookie } = await app.login();
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', {
      origin: 'https://evil.example',
      headers: { Cookie: cookie },
    });
    const [error] = await once(socket, 'error');
    assert.match(error.message, /403/);
    assert.equal(app.received.length, 0);
  });

  it('rejects cross-origin cookie mutations and arbitrary native origins', async () => {
    const { cookie } = await app.login();
    assert.equal((await post(app, '/auth/logout', {}, { Cookie: cookie, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).status, 200);
    assert.equal(
      (await post(app, '/auth/native/start', { challenge: '0'.repeat(64) }, { Origin: 'https://evil.example' })).status,
      403
    );
  });

  it('binds native handoff to a proof secret, expires it and consumes it once', async () => {
    const start = await nativeStart(app);
    assert.equal((await post(app, '/auth/native/poll', start)).status, 202);
    assert.equal((await post(app, '/auth/native/poll', { ...start, secret: 'x'.repeat(43) })).status, 403);
    assert.equal((await app.login(start.id)).result.status, 200);
    const completed = await post(app, '/auth/native/poll', start);
    assert.equal(completed.status, 200);
    const session = await completed.json();
    assert.equal(session.token.length, 43);
    assert.equal(session.media.length, 43);
    assert.equal((await post(app, '/auth/native/poll', start)).status, 403);
    const stale = await nativeStart(app);
    app.advance(300001);
    assert.equal((await post(app, '/auth/native/poll', stale)).status, 403);
  });

  it('delivers native sign-in rejection promptly instead of leaving a pending login', async () => {
    const start = await nativeStart(app);
    app.overrideClaims({ aud: 'wrong-client' });
    assert.equal((await app.login(start.id)).result.status, 400);
    assert.equal((await post(app, '/auth/native/poll', start)).status, 401);
    assert.equal((await post(app, '/auth/native/poll', start)).status, 403);
  });

  it('escapes employee-controlled display names on the browser completion page', async () => {
    const start = await nativeStart(app);
    app.overrideClaims({ name: '<img src=x onerror=alert(1)>' });
    const { result } = await app.login(start.id);
    assert.equal(result.status, 200);
    const html = await result.text();
    assert.equal(html.includes('<img'), false);
    assert.match(html, /&lt;img/);
  });

  it('restricts media credentials to reads and preserves the separate panel-manager admin credential', async () => {
    const session = await nativeSession(app);
    const prefix = app.url + '/auth/media/' + session.media;
    assert.equal((await fetch(prefix + '/video_stream/stream?topic=/camera')).status, 200);
    assert.equal((await fetch(prefix + '/recordings/list')).status, 200);
    assert.equal((await fetch(prefix + '/api/panels/config')).status, 403);
    assert.equal((await post(app, '/auth/media/' + session.media + '/video_stream/stream', {})).status, 403);
    assert.equal((await fetch(prefix + '/mesh_resources/%252e%252e/private')).status, 400);
    const administrator = await post(
      app,
      '/api/panels/preview',
      {},
      { 'X-RoboBoy-Session': session.token, Authorization: 'Bearer manager-admin-token' }
    );
    assert.equal(administrator.status, 200);
    assert.equal(app.received.at(-1).headers.authorization, 'Bearer manager-admin-token');
    assert.equal(app.received.at(-1).headers['x-roboboy-session'], undefined);
    const camera = await post(
      app,
      '/webrtc/camera/whep',
      {},
      { 'X-RoboBoy-Session': session.token, Authorization: 'Bearer media-gateway-token' }
    );
    assert.equal(camera.status, 200);
    assert.equal(app.received.at(-1).headers.authorization, 'Bearer media-gateway-token');
  });

  it('rejects unauthenticated WebSocket messages before any robot connection', async () => {
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', { origin: 'tauri://localhost' });
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'publish', topic: '/cmd_vel', msg: {} }));
    const [code] = await once(socket, 'close');
    assert.equal(code, 1008);
    assert.equal(app.received.length, 0);
  });

  it('forwards native commands only after authentication and closes them on logout', async () => {
    const session = await nativeSession(app);
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', { origin: 'tauri://localhost' });
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'roboboy_auth', token: session.token }));
    socket.send(JSON.stringify({ op: 'roboboy_control', action: 'status' }));
    const [data] = await once(socket, 'message');
    assert.equal(JSON.parse(data.toString()).action, 'status');
    assert.equal(
      app.received.some(message => message.op === 'roboboy_auth'),
      false
    );
    const closed = once(socket, 'close');
    await post(app, '/auth/logout', {}, { 'X-RoboBoy-Session': session.token });
    await closed;
    assert.equal(
      (await fetch(app.url + '/auth/session', { headers: { 'X-RoboBoy-Session': session.token } })).status,
      401
    );
    assert.equal((await fetch(app.url + '/auth/media/' + session.media + '/recordings/list')).status, 401);
  });

  it('authenticates web WebSockets through cookies and revokes them on expiry', async () => {
    const { cookie } = await app.login();
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', {
      origin: app.origin,
      headers: { Cookie: cookie },
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'subscribe', topic: '/image' }));
    await once(socket, 'message');
    const closed = once(socket, 'close');
    app.advance(3600001);
    await closed;
    assert.equal((await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).status, 401);
  });

  it('moves a live native robot socket to a renewed session of the same employee', async () => {
    const first = await nativeSession(app);
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', { origin: 'tauri://localhost' });
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'roboboy_auth', token: first.token }));
    socket.send(JSON.stringify({ op: 'subscribe', topic: '/image' }));
    await once(socket, 'message');
    app.advance(3300000);
    const secret = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(secret).digest('hex');
    const started = await post(app, '/auth/native/start', { challenge }, { 'X-RoboBoy-Session': first.token });
    const renewal = { ...(await started.json()), secret };
    assert.equal((await app.login(renewal.id)).result.status, 200);
    const renewed = await (await post(app, '/auth/native/poll', renewal)).json();
    assert.ok(renewed.expires > first.expires);
    assert.notEqual(renewed.token, first.token);
    app.advance(300001);
    assert.equal(
      (await fetch(app.url + '/auth/session', { headers: { 'X-RoboBoy-Session': first.token } })).status,
      401
    );
    assert.equal(await stillForwarding(socket), true);
    const closed = once(socket, 'close');
    app.advance(3600000);
    await closed;
  });

  it('renews a web session in a second tab without loading another workspace', async () => {
    const { cookie } = await app.login();
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', {
      origin: app.origin,
      headers: { Cookie: cookie },
    });
    await once(socket, 'open');
    app.advance(3300000);
    const renewed = await app.login(undefined, { session: cookie, renew: true });
    assert.equal(renewed.result.status, 200);
    assert.match(await renewed.result.text(), /Sign-in complete/);
    assert.equal((await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).status, 401);
    const body = await (await fetch(app.url + '/auth/session', { headers: { Cookie: renewed.cookie } })).json();
    assert.equal(body.user.id, 'employee-1');
    app.advance(300001);
    assert.equal(await stillForwarding(socket), true);
  });

  it('closes robot sockets when a different employee signs in on the same browser', async () => {
    const { cookie } = await app.login();
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', {
      origin: app.origin,
      headers: { Cookie: cookie },
    });
    await once(socket, 'open');
    const closed = once(socket, 'close');
    app.overrideClaims({ sub: 'employee-2', name: 'Bob Employee' });
    assert.equal((await app.login(undefined, { session: cookie, renew: true })).result.status, 200);
    await closed;
  });

  it('cleans up expired browser transactions and rejects malformed requests', async () => {
    const start = await fetch(app.url + '/auth/login', { redirect: 'manual' });
    app.advance(300001);
    const authorize = await fetch(start.headers.get('location'), { redirect: 'manual' });
    const callback = new URL(authorize.headers.get('location'));
    assert.equal(
      (
        await fetch(app.url + callback.pathname + callback.search, {
          headers: { Cookie: start.headers.getSetCookie()[0].split(';')[0] },
          redirect: 'manual',
        })
      ).status,
      400
    );
    assert.equal((await post(app, '/auth/native/start', { challenge: 'not-a-challenge' })).status, 400);
  });
});

it('supports explicitly disabled login without contacting an identity provider', async () => {
  const backend = await fixture();
  const open = await createEnterpriseGateway({
    enabled: false,
    origin: 'https://robot.example',
    upstream: `http://127.0.0.1:${backend.backend.address().port}`,
  });
  open.server.listen(0, '127.0.0.1');
  await once(open.server, 'listening');
  try {
    const url = `http://127.0.0.1:${open.server.address().port}`;
    const response = await fetch(url + '/recordings/list');
    assert.equal(response.status, 200);
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/websocket');
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'subscribe', topic: '/image' }));
    await once(socket, 'message');
    socket.close();
    const preflight = await fetch(url + '/recordings/list', {
      method: 'OPTIONS',
      headers: { Origin: 'tauri://localhost' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'tauri://localhost');
    assert.equal((await fetch(url + '/auth/session')).status, 404);
  } finally {
    await open.close();
    await backend.close();
  }
});

it('applies an explicit employee group allowlist using verified claims', async () => {
  const app = await fixture({ requiredGroup: 'employee-only' });
  try {
    assert.equal((await app.login()).result.status, 403);
    app.overrideClaims({ groups: ['employee-only'] });
    assert.equal((await app.login()).result.status, 303);
  } finally {
    await app.close();
  }
});

it('accepts Keycloak group paths, a configured claim and groups released only by userinfo', async () => {
  for (const [options, claims] of [
    [{}, { groups: ['/employee-only'] }],
    [{ groupsClaim: 'roles' }, { groups: undefined, roles: 'employee-only' }],
    [{ userinfo: { groups: ['employee-only'] } }, { groups: undefined }],
  ]) {
    const app = await fixture({ requiredGroup: 'employee-only', ...options });
    try {
      app.overrideClaims(claims);
      assert.equal((await app.login()).result.status, 303);
    } finally {
      await app.close();
    }
  }
  const app = await fixture({ requiredGroup: 'employee-only', userinfo: { groups: ['other'] } });
  try {
    app.overrideClaims({ groups: undefined });
    const { result } = await app.login();
    assert.equal(result.status, 403);
    assert.match(result.headers.get('content-type'), /text\/html/);
  } finally {
    await app.close();
  }
});

it('keeps the configured session lifetime when the provider issues short-lived ID tokens', async () => {
  const app = await fixture({ sessionSeconds: 3600 });
  try {
    app.overrideClaims({ exp: Math.floor(Date.now() / 1000) + 300 });
    const { cookie } = await app.login();
    app.advance(600000);
    assert.equal((await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).status, 200);
    app.advance(3000001);
    assert.equal((await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).status, 401);
  } finally {
    await app.close();
  }
});

it('shows a page for a cancelled provider sign-in and reports it to a waiting app', async () => {
  const app = await fixture({ prompt: 'off' });
  try {
    const secret = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(secret).digest('hex');
    const headers = { 'Content-Type': 'application/json', Origin: 'tauri://localhost' };
    const { id } = await (
      await fetch(app.url + '/auth/native/start', { method: 'POST', headers, body: JSON.stringify({ challenge }) })
    ).json();
    const start = await fetch(`${app.url}/auth/login?native=${id}`, { redirect: 'manual' });
    const login = start.headers.getSetCookie()[0].split(';')[0];
    assert.equal(new URL(start.headers.get('location')).searchParams.has('prompt'), false);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const result = await fetch(`${app.url}/auth/callback?error=access_denied&state=${state}`, {
      headers: { Cookie: login },
    });
    assert.equal(result.status, 403);
    assert.match(await result.text(), /cancelled or denied/);
    const poll = await fetch(app.url + '/auth/native/poll', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id, secret }),
    });
    assert.equal(poll.status, 401);
  } finally {
    await app.close();
  }
});
