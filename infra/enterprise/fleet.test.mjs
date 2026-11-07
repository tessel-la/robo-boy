import { it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { fixture } from './test/provider.mjs';
import { robots, branding } from './config.mjs';

it('validates company theme CSS and a bounded deployment-owned robot registry', () => {
  const good = {
    id: 'sunrise',
    name: 'Sunrise',
    colors: { primary: '#fa6147', secondary: '#111111', background: '#e5e5df' },
  };
  assert.deepEqual(branding({ theme: good }).theme, good);
  for (const theme of [
    { ...good, id: 'x"] {body{display:none}' },
    { ...good, colors: { ...good.colors, primary: 'red;display:none' } },
    { ...good, fontFamily: 'url(evil)' },
  ])
    assert.throws(() => branding({ theme }));
  assert.equal(
    robots([{ id: 'assembly', name: 'Assembly' }], 'http://127.0.0.1:4181')[0].upstream,
    'http://127.0.0.1:4181'
  );
  for (const value of [
    [{ id: '../private', name: 'Bad' }],
    [{ id: 'assembly', name: 'Assembly', upstream: 'http://untrusted.example:9090' }],
    [{ id: 'assembly', name: 'Assembly', upstream: 'http://user:secret@localhost' }],
    [{ id: 'assembly', name: 'Assembly', upstream: 'http://localhost/private' }],
    [
      { id: 'a', name: 'A' },
      { id: 'a', name: 'A2' },
    ],
  ])
    assert.throws(() => robots(value, 'http://127.0.0.1:4181'));
});

it('one company session reaches distinct configured robots and logout closes both connections', async t => {
  const targets = [];
  for (const id of ['assembly', 'inspection']) {
    const server = http.createServer((request, response) => {
      assert.equal(request.headers['x-roboboy-session'], undefined);
      response.writeHead(200, {
        'Content-Type': 'application/json',
        ...(request.url.startsWith('/webrtc/') ? { Location: '/webrtc/camera/session-1' } : {}),
      });
      response.end(JSON.stringify({ id, path: request.url }));
    });
    const ws = new WebSocketServer({ server });
    ws.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({ id }))));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    targets.push({ id, name: id.toUpperCase(), upstream: `http://127.0.0.1:${server.address().port}`, server, ws });
  }
  const app = await fixture({ robots: targets.map(({ id, name, upstream }) => ({ id, name, upstream })) });
  t.after(async () => {
    await app.close();
    for (const { server, ws } of targets) {
      for (const socket of ws.clients) socket.terminate();
      ws.close();
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    }
  });
  assert.equal((await fetch(app.url + '/robots/assembly/recordings/list')).status, 401);
  const { cookie } = await app.login();
  const session = await (await fetch(app.url + '/auth/session', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(
    session.robots,
    targets.map(({ id, name }) => ({ id, name }))
  );
  assert.equal(JSON.stringify(session).includes('upstream'), false);
  const sockets = [];
  for (const { id } of targets) {
    const response = await fetch(`${app.url}/robots/${id}/recordings/list`, { headers: { Cookie: cookie } });
    assert.deepEqual(await response.json(), { id, path: '/recordings/list' });
    const socket = new WebSocket(`${app.url.replace('http:', 'ws:')}/robots/${id}/websocket`, {
      origin: app.origin,
      headers: { Cookie: cookie },
    });
    await once(socket, 'open');
    socket.send(JSON.stringify({ op: 'roboboy_control', action: 'status' }));
    const [message] = await once(socket, 'message');
    assert.equal(JSON.parse(message.toString()).id, id);
    sockets.push(socket);
  }
  for (const path of [
    '/robots/missing/recordings/list',
    '/robots/assembly/auth/session',
    '/robots/assembly/api/panels/config',
  ])
    assert.equal((await fetch(app.url + path, { headers: { Cookie: cookie } })).status, 404);
  const whep = await fetch(`${app.url}/robots/assembly/webrtc/camera/whep`, { headers: { Cookie: cookie } });
  assert.equal(whep.headers.get('location'), '/robots/assembly/webrtc/camera/session-1');
  const secret = randomBytes(32).toString('base64url');
  const post = (path, body, headers = {}) =>
    fetch(app.url + path, {
      method: 'POST',
      headers: { Origin: 'tauri://localhost', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const started = await (
    await post('/auth/native/start', { challenge: createHash('sha256').update(secret).digest('hex') })
  ).json();
  await app.login(started.id);
  const native = await (await post('/auth/native/poll', { id: started.id, secret })).json();
  assert.deepEqual(native.robots, session.robots);
  const media = await fetch(`${app.url}/auth/media/${native.media}/robots/inspection/recordings/list`);
  assert.deepEqual(await media.json(), { id: 'inspection', path: '/recordings/list' });
  assert.equal((await post(`/auth/media/${native.media}/robots/inspection/recordings/list`, {})).status, 403);
  await post('/auth/logout', {}, { 'X-RoboBoy-Session': native.token });
  assert.equal((await fetch(`${app.url}/auth/media/${native.media}/robots/inspection/recordings/list`)).status, 401);
  const closed = sockets.map(socket => once(socket, 'close'));
  await fetch(app.url + '/auth/logout', { method: 'POST', headers: { Origin: app.origin, Cookie: cookie } });
  await Promise.all(closed);
  for (const { id } of targets)
    assert.equal((await fetch(`${app.url}/robots/${id}/recordings/list`, { headers: { Cookie: cookie } })).status, 401);
});
