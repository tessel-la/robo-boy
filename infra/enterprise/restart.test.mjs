import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { fixture } from './test/provider.mjs';

describe('Access sessions across gateway restarts', { timeout: 20000 }, () => {
  let app, directory, file;
  const post = (path, body, token) => fetch(app.url + path, {
    method: 'POST',
    headers: { Origin: 'tauri://localhost', 'Content-Type': 'application/json', ...(token ? { 'X-RoboBoy-Session': token } : {}) },
    body: JSON.stringify(body),
  });
  const beginNative = async () => {
    const secret = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(secret).digest('hex');
    const start = await (await post('/auth/native/start', { challenge })).json();
    return { id: start.id, secret };
  };
  const signInNative = async () => {
    const proof = await beginNative();
    assert.equal((await app.login(proof.id)).result.status, 200);
    return (await post('/auth/native/poll', proof)).json();
  };
  const status = headers => fetch(app.url + '/auth/session', { headers });
  const socket = async headers => {
    const client = new WebSocket(app.url.replace('http:', 'ws:') + '/websocket', { headers });
    await once(client, 'open');
    return client;
  };
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'roboboy-restart-'));
    file = join(directory, 'sessions.json');
    app = await fixture({ sessionFile: file });
  });
  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('restores a browser session with its original expiry and reconnects its robot socket', async () => {
    const { cookie } = await app.login();
    const headers = { Cookie: cookie };
    const before = await (await status(headers)).json();
    const client = await socket(headers);
    const closed = once(client, 'close');
    await app.restart();
    await closed;
    assert.deepEqual(await (await status(headers)).json(), before);
    const reconnected = await socket(headers);
    const echo = once(reconnected, 'message');
    reconnected.send(JSON.stringify({ op: 'subscribe', topic: '/camera' }));
    assert.equal(JSON.parse((await echo)[0].toString()).op, 'subscribe');
    reconnected.close();
  });

  it('restores native API, read-only media and first-frame WebSocket authentication', async () => {
    const native = await signInNative();
    const saved = readFileSync(file, 'utf8');
    assert.equal(saved.includes(native.token), false);
    assert.equal(saved.includes(native.media), false);
    await app.restart();
    const headers = { 'X-RoboBoy-Session': native.token };
    assert.equal((await status(headers)).status, 200);
    const media = `/auth/media/${native.media}/video_stream/stream?topic=/camera`;
    assert.equal((await fetch(app.url + media)).status, 200);
    assert.equal((await post(media, {})).status, 403);
    const client = await socket();
    const echo = once(client, 'message');
    client.send(JSON.stringify({ op: 'roboboy_auth', token: native.token }));
    client.send(JSON.stringify({ op: 'subscribe', topic: '/camera' }));
    assert.equal(JSON.parse((await echo)[0].toString()).op, 'subscribe');
    client.close();
  });

  it('does not resurrect revoked browser or native sessions and media', async () => {
    const { cookie } = await app.login();
    const native = await signInNative();
    assert.equal((await fetch(app.url + '/auth/logout', {
      method: 'POST', headers: { Cookie: cookie, Origin: app.origin },
    })).status, 200);
    assert.equal((await post('/auth/logout', {}, native.token)).status, 200);
    await app.restart();
    assert.equal((await status({ Cookie: cookie })).status, 401);
    assert.equal((await status({ 'X-RoboBoy-Session': native.token })).status, 401);
    assert.equal((await fetch(`${app.url}/auth/media/${native.media}/recordings/list`)).status, 401);
  });

  it('expires sessions during downtime without extending their lifetime', async () => {
    const { cookie } = await app.login();
    // Advance the fixture clock without the running gateway's expiry sweep.
    app.advance(3600001, false);
    await app.restart();
    assert.equal((await status({ Cookie: cookie })).status, 401);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sessions, []);
  });

  it('invalidates recovered sessions when origin, lifetime or provider access policy changes', async () => {
    for (const change of [{ origin: 'https://other.example' }, { sessionSeconds: 600 }, { requiredGroup: 'other-team' }]) {
      const { cookie } = await app.login();
      await app.restart(change);
      assert.equal((await status({ Cookie: cookie })).status, 401);
      await app.restart();
      assert.equal((await status({ Cookie: cookie })).status, 401);
    }
  });

  it('persists web renewal and does not revive the replaced credential after restart', async () => {
    const first = await app.login();
    const renewed = await app.login(undefined, { session: first.cookie, renew: true });
    assert.equal(renewed.result.status, 200);
    await app.restart();
    assert.equal((await status({ Cookie: first.cookie })).status, 401);
    assert.equal((await status({ Cookie: renewed.cookie })).status, 200);
  });

  it('discards unredeemed native handoffs and pending browser callbacks', async () => {
    const proof = await beginNative();
    const { callback, browserCookie } = await app.login(proof.id);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sessions, []);
    const start = await fetch(app.url + '/auth/login', { redirect: 'manual' });
    const browser = start.headers.getSetCookie()[0].split(';')[0];
    const authorized = await fetch(start.headers.get('location'), { redirect: 'manual' });
    const pending = new URL(authorized.headers.get('location'));
    await app.restart();
    assert.equal((await post('/auth/native/poll', proof)).status, 403);
    for (const [url, cookie] of [[callback, browserCookie], [pending, browser]])
      assert.equal((await fetch(app.url + url.pathname + url.search, { headers: { Cookie: cookie } })).status, 400);
  });

  it('does not acknowledge a failed logout commit and closes live authenticated sockets', async () => {
    const { cookie } = await app.login();
    const client = await socket({ Cookie: cookie });
    const closed = once(client, 'close');
    renameSync(directory, directory + '-unavailable');
    writeFileSync(directory, 'not a directory');
    try {
      assert.equal((await fetch(app.url + '/auth/logout', {
        method: 'POST', headers: { Cookie: cookie, Origin: app.origin },
      })).status, 503);
      await closed;
      assert.equal((await status({ Cookie: cookie })).status, 503);
      assert.equal((await fetch(app.url + '/recordings/list', { headers: { Cookie: cookie } })).status, 503);
    } finally {
      rmSync(directory);
      renameSync(directory + '-unavailable', directory);
    }
  });
});
