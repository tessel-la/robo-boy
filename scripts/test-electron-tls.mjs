#!/usr/bin/env node
/** Real network checks: self-signed robot HTTPS/WSS works, public TLS errors fail closed. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron } from '@playwright/test';
import { WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(tmpdir(), 'robo-boy-tls-'));
const echo = (req, res) => {
  res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });
  req.pipe(res);
};
const http = httpServer(echo);
let https;
let electron;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=github.com', '-addext', 'subjectAltName=DNS:github.com,DNS:robot.local,IP:127.0.0.1',
    '-keyout', path.join(work, 'key.pem'), '-out', path.join(work, 'cert.pem')], { stdio: 'ignore' });
  https = httpsServer({ key: await readFile(path.join(work, 'key.pem')), cert: await readFile(path.join(work, 'cert.pem')) }, echo);
  const sockets = new WebSocketServer({ server: https });
  sockets.on('connection', socket => socket.send('robot-connected'));
  await Promise.all([http, https].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const secure = `https://127.0.0.1:${https.address().port}`;
  const insecure = `http://127.0.0.1:${http.address().port}`;
  const publicUrl = `https://github.com:${https.address().port}`;
  const main = path.join(work, 'main.cjs');
  await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { app, BrowserWindow, protocol, net } from 'electron';
        import dns from 'node:dns';
        import { configureCertificates } from './electron/certificates';
        import { fetchPanelAsset } from './electron/panelFetch';
        app.setPath('userData', ${JSON.stringify(path.join(work, 'profile'))});
        app.commandLine.appendSwitch('host-resolver-rules', 'MAP github.com 127.0.0.1, MAP robot.local 127.0.0.1');
        // Node fetch has its own DNS/network stack; point its GitHub request to the same fake MITM.
        const lookup = dns.lookup;
        dns.lookup = (host, options, callback) => host === 'github.com'
          ? lookup('127.0.0.1', options, callback) : lookup(host, options, callback);
        globalThis.tlsCheckFetchPanel = fetchPanelAsset;
        protocol.registerSchemesAsPrivileged([
          {scheme:'app', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}
        ]);
        app.whenReady().then(async () => {
          configureCertificates();
          protocol.handle('app', () => new Response('<!doctype html><title>TLS check</title><body>TLS check</body>', {headers:{'content-type':'text/html'}}));
          const win = new BrowserWindow({show:false, webPreferences:{webSecurity:true}});
          await win.loadURL('app://robo-boy/index.html');
        });
      `,
    },
    outfile: main, bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = await _electron.launch({ args: [main], env, timeout: 30000 });
  const page = await electron.firstWindow();
  assert.equal(await electron.evaluate(({ app }) => app.commandLine.hasSwitch('ignore-certificate-errors')), false);
  for (const target of [secure, secure.replace('127.0.0.1', 'robot.local')]) {
    assert.equal(await page.evaluate(url => fetch(url, { method: 'POST', body: 'robot' }).then(r => r.text()), target), 'robot');
    assert.equal(await electron.evaluate(({ net }, url) => net.fetch(url).then(r => r.status), target), 200);
  }
  assert.equal(await page.evaluate(url => new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.onmessage = event => { resolve(event.data); socket.close(); };
    socket.onerror = () => reject(new Error('self-signed WSS failed'));
  }), secure.replace('https:', 'wss:')), 'robot-connected');
  console.log('PASS renderer HTTPS/WSS and main-process net.fetch accept local robot certificates');

  const rejected = await page.evaluate(url => fetch(url).then(() => false, () => true), publicUrl);
  assert.equal(rejected, true, 'renderer must reject an untrusted public certificate');
  const mainRejected = await electron.evaluate(async ({ net }, url) => {
    try { await net.fetch(url); return false; } catch { return true; }
  }, publicUrl);
  assert.equal(mainRejected, true, 'Chromium net.fetch must reject an untrusted public certificate');
  const panelError = await electron.evaluate(async (_electron, url) => {
    try { await globalThis.tlsCheckFetchPanel(url); return null; }
    catch (error) { return error.cause?.code ?? error.message; }
  }, publicUrl);
  assert.equal(panelError, 'DEPTH_ZERO_SELF_SIGNED_CERT', 'Node panel fetch must verify the certificate');
  console.log('PASS renderer, Chromium net.fetch and Node panel fetch reject fake GitHub TLS');

  // Exercise the opaque panel frame's secure context and real SDP signaling over both transports.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.srcdoc = '<body>panel</body>';
    document.body.append(frame);
  });
  await page.waitForFunction(() => document.querySelector('iframe')?.contentWindow);
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  assert.ok(frame);
  for (const gateway of [insecure, secure]) {
    const result = await frame.evaluate(async url => {
      const peer = new RTCPeerConnection();
      const robot = new RTCPeerConnection();
      try {
        peer.createDataChannel('telemetry');
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const remoteOffer = await fetch(url, { method: 'POST', body: offer.sdp }).then(r => r.text());
        await robot.setRemoteDescription({ type: 'offer', sdp: remoteOffer });
        const answer = await robot.createAnswer();
        await robot.setLocalDescription(answer);
        const remoteAnswer = await fetch(url, { method: 'POST', body: answer.sdp }).then(r => r.text());
        await peer.setRemoteDescription({ type: 'answer', sdp: remoteAnswer });
        return { secure: isSecureContext, signaling: peer.signalingState };
      } finally { peer.close(); robot.close(); }
    }, gateway);
    assert.deepEqual(result, { secure: true, signaling: 'stable' });
  }
  console.log('PASS opaque panel WebRTC offer/answer signaling over HTTP and self-signed HTTPS');
} finally {
  await electron?.close();
  for (const server of [http, https]) {
    server?.closeAllConnections();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  await rm(work, { recursive: true, force: true });
}
