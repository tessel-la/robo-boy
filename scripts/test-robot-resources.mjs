#!/usr/bin/env node
/** Real Electron/Three integration. Optional live, read-only check:
 * ROBOBOY_TEST_ROSBRIDGE=ws://10.8.0.1:9090 ROBOBOY_TEST_MESH_BASE=http://10.8.0.1:8000 npm run test:robot-resources
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { _electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(tmpdir(), 'robo-boy-resources-'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
const obj = 'mtllib arm.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl paint\nf 1/1 2/2 3/3\n';
const facet = 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n';
// The STL changes version when a test swaps the robot's meshes, the way a new simulation would.
let stlVersion = 1;
const stl = () => `solid arm\n${facet.repeat(stlVersion)}endsolid arm`;
const stlStatuses = [];
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  if (req.url === '/assets/collision/arm.stl') {
    // Validators without Cache-Control: left to its heuristics, Chromium would reuse this for days.
    const etag = `"arm-${stlVersion}"`;
    res.setHeader('etag', etag);
    res.setHeader('last-modified', new Date(Date.now() - 30 * 86400e3).toUTCString());
    if (req.headers['if-none-match'] === etag) {
      stlStatuses.push(304);
      res.statusCode = 304;
      return res.end();
    }
    stlStatuses.push(200);
    return res.end(stl());
  }
  // Deliberately no Access-Control-Allow-Origin: same deployment as the remote robot.
  if (req.url === '/assets/visual/arm.obj') res.end(obj);
  else if (req.url === '/assets/visual/arm.mtl') res.end('newmtl paint\nKd 1 1 1\nmap_Kd paint.png\n');
  else if (req.url === '/assets/visual/paint.png') {
    res.setHeader('content-type', 'image/png');
    res.end(png);
  } else if (req.url === '/assets/collision/arm.stl') res.end(stl);
  else {
    res.statusCode = 404;
    res.end('missing');
  }
});
let electron;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const renderer = path.join(work, 'renderer.js');
  const preload = path.join(work, 'preload.cjs');
  await Promise.all([
    build({
      entryPoints: [path.join(root, 'e2e/fixtures/robotResourceRenderer.ts')],
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
  await build({
    stdin: {
      resolveDir: root,
      contents: `
      import { app, BrowserWindow, protocol, net } from 'electron';
      import { readFile } from 'node:fs/promises';
      import { registerRobotResources, robotResourceScheme } from './electron/robotResources';
      app.setPath('userData', ${JSON.stringify(path.join(work, 'profile'))});
      protocol.registerSchemesAsPrivileged([
        {scheme:'app', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}, robotResourceScheme
      ]);
      app.whenReady().then(async () => {
        registerRobotResources();
        protocol.handle('app', async request => {
          const url = new URL(request.url);
          if (url.pathname.startsWith('/mesh_resources/')) {
            return net.fetch('http://127.0.0.1:${port}/assets/' + url.pathname.slice('/mesh_resources/'.length));
          }
          if (url.pathname === '/renderer.js') return new Response(await readFile(${JSON.stringify(renderer)}), {headers:{'content-type':'text/javascript'}});
          return new Response('<script src="/renderer.js"></script>', {headers:{'content-type':'text/html'}});
        });
        const win = new BrowserWindow({show:false, webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,nodeIntegration:false,webSecurity:true}});
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
  electron = await _electron.launch({ args: [main], timeout: 30000 });
  const page = await electron.firstWindow();
  await page.waitForFunction(() => typeof window.loadTestRobot === 'function');
  const base = `http://127.0.0.1:${port}/assets`;
  assert.equal(
    await page.evaluate(
      url =>
        fetch(url).then(
          () => true,
          () => false
        ),
      `${base}/visual/arm.obj`
    ),
    false,
    'baseline must reproduce browser CORS rejection'
  );
  const description = `<robot name="test"><link name="base"><visual><geometry><mesh filename="package://visual/arm.obj"/></geometry></visual></link><link name="stl"><visual><geometry><mesh filename="package://collision/arm.stl"/></geometry></visual></link></robot>`;
  for (const host of ['127.0.0.1', 'localhost']) {
    const result = await page.evaluate(({ base, description }) => window.loadTestRobot(base, description), {
      base: `http://${host}:${port}/assets`,
      description,
    });
    assert.equal(result.meshes, 2);
    assert.equal(result.textures, 1);
    assert.deepEqual(result.errors, []);
    console.log(`PASS native OBJ + MTL + texture + STL, ${host}, custom port ${port}`);
  }
  assert.ok(requests.includes('/assets/visual/paint.png'));
  const reload = async () => {
    stlStatuses.length = 0;
    const result = await page.evaluate(({ base, description }) => window.loadTestRobot(base, description), {
      base: `http://127.0.0.1:${port}/assets`,
      description,
    });
    assert.deepEqual(result.errors, []);
    return { statuses: [...stlStatuses], vertices: result.vertices };
  };
  assert.deepEqual(
    await reload(),
    { statuses: [304], vertices: 6 },
    'an unchanged mesh must be revalidated, not downloaded'
  );
  stlVersion = 2;
  assert.deepEqual(await reload(), { statuses: [200], vertices: 9 }, 'a replaced mesh must be downloaded at once');
  assert.deepEqual(await reload(), { statuses: [304], vertices: 9 }, 'the replaced mesh is cached in turn');
  console.log('PASS meshes are cached, revalidated on every load, and reloaded when replaced');
  const nativeUrl = `robot-resource://localhost/resource?${new URLSearchParams({ base, url: `${base}/visual/arm.obj` })}`;
  const beforeSandbox = requests.length;
  const sandboxCanRead = await page.evaluate(
    url =>
      new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.sandbox.add('allow-scripts');
        const timer = setTimeout(() => reject(new Error('Sandbox probe timed out')), 10000);
        const receive = event => {
          if (event.source !== frame.contentWindow) return;
          clearTimeout(timer);
          window.removeEventListener('message', receive);
          frame.remove();
          resolve(event.data);
        };
        window.addEventListener('message', receive);
        frame.srcdoc = `<script>fetch(${JSON.stringify(url)}).then(r=>r.ok).then(ok=>parent.postMessage(ok,'*'),()=>parent.postMessage(false,'*'))</script>`;
        document.body.append(frame);
      }),
    nativeUrl
  );
  assert.equal(sandboxCanRead, false, 'opaque panel frames must not inherit native asset reads');
  assert.equal(requests.length, beforeSandbox, 'untrusted frames must not trigger native network requests');
  console.log('PASS sandboxed panel origin remains isolated');
  // Use exactly the same loaders without the preload to check the web proxy path.
  const nextWindow = electron.waitForEvent('window');
  const browserWindow = await electron.evaluate(({ BrowserWindow }) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: true },
    });
    void win.loadURL('app://robo-boy/index.html');
    return win.id;
  });
  const webPage = await nextWindow;
  if (!webPage) throw new Error(`Missing web fixture window ${browserWindow}`);
  await webPage.waitForFunction(() => typeof window.loadTestRobot === 'function');
  const webResult = await webPage.evaluate(
    description => window.loadTestRobot('/mesh_resources', description),
    description
  );
  assert.equal(webResult.meshes, 2);
  assert.equal(webResult.textures, 1);
  assert.deepEqual(webResult.errors, []);
  console.log('PASS web same-origin mesh proxy');
  if (process.env.ROBOBOY_TEST_ROSBRIDGE && process.env.ROBOBOY_TEST_MESH_BASE) {
    const result = await page.evaluate(({ base, rosbridge }) => window.loadTestRobot(base, undefined, rosbridge), {
      base: process.env.ROBOBOY_TEST_MESH_BASE,
      rosbridge: process.env.ROBOBOY_TEST_ROSBRIDGE,
    });
    assert.ok(result.meshes > 0, 'remote description must produce visible mesh geometry');
    assert.deepEqual(result.errors, []);
    console.log('PASS live ROS description and remote assets', JSON.stringify(result));
  }
} finally {
  await electron?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
