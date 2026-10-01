#!/usr/bin/env node
/** Real Electron check of the panel embed route (`/<port>/` frames). Optional live, read-only check
 * against a robot's Robo-Boy proxy serving a page on an allowed port:
 * ROBOBOY_TEST_EMBED_BASE=https://robot.local ROBOBOY_TEST_EMBED_PATH=/8089/ npm run test:embed-proxy
 * ROBOBOY_TEST_EMBED_SELECTOR (default `body`) names the element that shows the page has rendered.
 * ROBOBOY_TEST_EMBED_DIRECT_PORTS (for example 8089) frames those ports from the robot directly.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { _electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(tmpdir(), 'robo-boy-embed-'));

// Stands in for the robot's Robo-Boy proxy: its /<port>/ route, the CORS headers it adds for opaque
// panel frames, and compression, which the shell has to hand on decoded.
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  const send = (type, body, headers = {}) => {
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, {
      'content-type': type,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': '*',
      'x-viewer-session': 'session-1',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
      ...headers,
    });
    res.end(gzip ? gzipSync(body) : body);
  };
  if (req.url === '/8089/') send('text/html', '<!doctype html><title>embedded</title><script type="module" src="app.js"></script>');
  else if (req.url === '/8089/app.js') {
    send(
      'text/javascript',
      `const response = await fetch('api/state', { method: 'POST', body: 'ping' });
       document.body.dataset.result = JSON.stringify({ body: await response.text(), session: response.headers.get('x-viewer-session') });`
    );
  } else if (req.url === '/8089/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => send('application/json', JSON.stringify({ echoed: body })));
  } else if (req.url === '/8089/moved') {
    res.writeHead(302, { location: '/8089/' });
    res.end();
  } else {
    res.writeHead(404);
    res.end('This port is not published for embedding.');
  }
});

// Stands in for a service a robot publishes directly, with no proxy in front: it knows nothing of
// the /<port> prefix and redirects within its own root.
const directRequests = [];
const directServer = createServer((req, res) => {
  directRequests.push(`${req.method} ${req.url}`);
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  const send = (type, body) => {
    res.writeHead(200, { 'content-type': type, 'x-viewer-session': 'direct-1', ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
    res.end(gzip ? gzipSync(body) : body);
  };
  if (req.url === '/') send('text/html', '<!doctype html><title>direct</title><script type="module" src="app.js"></script>');
  else if (req.url === '/app.js') {
    send(
      'text/javascript',
      `const response = await fetch('api/state', { method: 'POST', body: 'pong' });
       document.body.dataset.result = JSON.stringify({ body: await response.text(), session: response.headers.get('x-viewer-session') });`
    );
  } else if (req.url === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => send('application/json', JSON.stringify({ echoed: body })));
  } else if (req.url === '/moved') {
    res.writeHead(302, { location: '/' });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

let electron;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => directServer.listen(0, '127.0.0.1', resolve));
  const robotProxy = `http://127.0.0.1:${server.address().port}`;
  const sandboxDir = path.join(work, 'public');
  const sandboxBuild = spawnSync(process.execPath, [path.join(root, 'scripts/build-panel-sandbox.mjs')], {
    env: { ...process.env, ROBOBOY_PUBLIC_DIR: sandboxDir },
    stdio: 'inherit',
  });
  assert.equal(sandboxBuild.status, 0, 'panel sandbox must build');
  const renderer = path.join(work, 'renderer.js');
  const preload = path.join(work, 'preload.cjs');
  await Promise.all([
    build({
      entryPoints: [path.join(root, 'e2e/fixtures/embedRenderer.ts')],
      outfile: renderer,
      bundle: true,
      platform: 'browser',
      format: 'iife',
    }),
    build({
      entryPoints: [path.join(root, 'electron/preload.ts')],
      outfile: preload,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    }),
  ]);
  const main = path.join(work, 'main.cjs');
  // Mirrors the scheme routing in electron/main.ts: embed hosts go to the embed proxy, the app's own
  // host serves the renderer and nothing else.
  await build({
    stdin: {
      resolveDir: root,
      contents: `
      import { app, BrowserWindow, protocol } from 'electron';
      import { readFile } from 'node:fs/promises';
      import { fetchEmbed, isEmbedHost, registerEmbedProxy } from './electron/embedProxy';
      app.commandLine.appendSwitch('ignore-certificate-errors');
      app.setPath('userData', ${JSON.stringify(path.join(work, 'profile'))});
      protocol.registerSchemesAsPrivileged([
        {scheme:'app', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}
      ]);
      app.whenReady().then(async () => {
        registerEmbedProxy();
        const sandbox = async () => new Response(await readFile(${JSON.stringify(path.join(sandboxDir, 'panel-sandbox.html'))}), {headers:{'content-type':'text/html'}});
        protocol.handle('app', async request => {
          const url = new URL(request.url);
          if (isEmbedHost(url.hostname)) return fetchEmbed(request, sandbox);
          if (url.pathname === '/renderer.js') return new Response(await readFile(${JSON.stringify(renderer)}), {headers:{'content-type':'text/javascript'}});
          if (url.pathname === '/index.html') return new Response('<body><script src="/renderer.js"></script></body>', {headers:{'content-type':'text/html'}});
          return new Response('Not found', {status: 404});
        });
        const win = new BrowserWindow({width: 900, height: 600, show:false, webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,sandbox:false,webSecurity:true}});
        await win.loadURL('app://robo-boy/index.html');
      });
    `,
    },
    outfile: main,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  });

  const env = { ...process.env };
  // An editor's integrated terminal can export this, which turns Electron into plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({ args: [main], env, timeout: 30000 });
  const page = await electron.firstWindow();
  await page.waitForFunction(() => typeof window.openPanelSandbox === 'function');

  // What the WebView panel does inside its sandbox: frame /<port>/ in the panel root.
  const frameInSandbox = async (embedBaseUrl, framePath, directPorts = []) => {
    const sandboxUrl = await page.evaluate(([base, ports]) => window.openPanelSandbox(base, ports), [embedBaseUrl, directPorts]);
    const sandbox = page.frames().find(frame => frame.url() === sandboxUrl);
    assert.ok(sandbox, `sandbox frame must load at ${sandboxUrl}`);
    await sandbox.evaluate(src => {
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.style.cssText = 'width:100%;height:100%;border:0';
      document.getElementById('panel-root').replaceChildren(frame);
    }, framePath);
    return { sandboxUrl, embedHost: new URL(sandboxUrl).host };
  };
  const waitForFrame = async (predicate, timeout = 15000) => {
    for (const started = Date.now(); Date.now() - started < timeout; await page.waitForTimeout(100)) {
      const frame = page.frames().find(candidate => predicate(candidate.url()));
      if (frame) return frame;
    }
    throw new Error(`No matching frame among ${page.frames().map(frame => frame.url()).join(', ')}`);
  };

  const { sandboxUrl, embedHost } = await frameInSandbox(robotProxy, '/8089/moved');
  assert.match(sandboxUrl, /^app:\/\/embed-[0-9a-f]{16}\/panel-sandbox\.html\?parentOrigin=app%3A%2F%2Frobo-boy$/);
  const target = await waitForFrame(url => url === `app://${embedHost}/8089/`);
  await target.waitForFunction(() => document.body?.dataset.result, undefined, { timeout: 15000 });
  const result = JSON.parse(await target.evaluate(() => document.body.dataset.result));
  assert.deepEqual(result, { body: JSON.stringify({ echoed: 'ping' }), session: 'session-1' });
  assert.deepEqual(requests, ['/8089/moved', '/8089/', '/8089/app.js', '/8089/api/state']);
  console.log('PASS panel frame reaches the robot proxy: redirect, gzip module script, POST, exposed headers');

  const before = requests.length;
  const unregistered = await page.evaluate(() =>
    fetch('app://embed-0000000000000000/8089/').then(response => response.status, () => 'blocked')
  );
  const appHost = await page.evaluate(() => fetch('/8089/').then(response => response.status));
  assert.notEqual(unregistered, 200);
  assert.equal(appHost, 404, "the app's own host still serves only the renderer");
  assert.equal(requests.length, before, 'unregistered hosts must not reach any robot');
  console.log('PASS unregistered embed hosts and the app host reach no robot');

  // A robot without a proxy: its allowed port is fetched directly, the /<port> prefix stripped, and
  // the service's own root redirect lands back under /<port>/ on the embed host.
  const directPort = directServer.address().port;
  const proxyRequests = requests.length;
  const direct = await frameInSandbox('https://127.0.0.1', `/${directPort}/moved`, [directPort]);
  const directFrame = await waitForFrame(url => url === `app://${direct.embedHost}/${directPort}/`);
  await directFrame.waitForFunction(() => document.body?.dataset.result, undefined, { timeout: 15000 });
  assert.deepEqual(JSON.parse(await directFrame.evaluate(() => document.body.dataset.result)),
    { body: JSON.stringify({ echoed: 'pong' }), session: 'direct-1' });
  assert.deepEqual(directRequests, ['GET /moved', 'GET /', 'GET /app.js', 'POST /api/state']);
  // Any other port is refused in the shell, and nothing goes to the robot's proxy either.
  const refused = await page.evaluate(
    ([host, port]) => fetch(`app://${host}/${port}/`).then(response => response.status, () => 'blocked'),
    [direct.embedHost, directPort + 1]
  );
  assert.equal(refused, 404);
  assert.equal(directRequests.length, 4, 'a port outside the list must not reach the robot');
  assert.equal(requests.length, proxyRequests, 'a direct target never goes through the robot proxy');
  console.log('PASS direct ports: the allowed port is framed from the robot, prefix stripped; others are refused');

  if (process.env.ROBOBOY_TEST_EMBED_BASE) {
    const liveDirectPorts = (process.env.ROBOBOY_TEST_EMBED_DIRECT_PORTS || '').split(/[\s,]+/).filter(Boolean).map(Number);
    const live = await frameInSandbox(process.env.ROBOBOY_TEST_EMBED_BASE, process.env.ROBOBOY_TEST_EMBED_PATH || '/8089/', liveDirectPorts);
    // The shell answers an unreachable robot with an error page, which also renders: require the
    // robot's own 200 first.
    const livePath = process.env.ROBOBOY_TEST_EMBED_PATH || '/8089/';
    const liveStatus = await page.evaluate(url => fetch(url).then(response => response.status), `app://${live.embedHost}${livePath}`);
    assert.equal(liveStatus, 200, `the robot must serve ${livePath} through the embed route`);
    const frame = await waitForFrame(url => url.startsWith(`app://${live.embedHost}/`) && !url.includes('panel-sandbox'));
    // The page rendered through the route once the chosen element exists and has content.
    const selector = process.env.ROBOBOY_TEST_EMBED_SELECTOR || 'body';
    await frame.waitForFunction(
      target => {
        const element = document.querySelector(target);
        return Boolean(element && (element.textContent?.trim() || element.children.length));
      },
      selector,
      { timeout: 120000 }
    );
    if (process.env.ROBOBOY_TEST_EMBED_SCREENSHOT) await page.screenshot({ path: process.env.ROBOBOY_TEST_EMBED_SCREENSHOT });
    console.log('PASS live robot page through the embed route', frame.url());
  }
} finally {
  await electron?.close();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => directServer.close(resolve));
  await rm(work, { recursive: true, force: true });
}
