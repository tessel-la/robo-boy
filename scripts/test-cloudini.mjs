import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium, firefox, _electron } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const work = await mkdtemp(path.join(tmpdir(), 'roboboy-cloudini-'));
const csp = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
const fixturePath = '/e2e/fixtures/cloudiniRenderer.html';
const mime = filename => filename.endsWith('.html') ? 'text/html' : 'text/javascript';
let server, browser, electron;
try {
  for (const mode of ['web', 'desktop']) {
    await build({ root, configFile: path.join(root, 'config/vite.config.ts'), publicDir: false,
      mode: mode === 'desktop' ? 'tauri' : 'test', base: mode === 'desktop' ? './' : '/', logLevel: 'warn',
      build: { outDir: path.join(work, mode), emptyOutDir: true,
        rollupOptions: { input: path.join(root, fixturePath) } } });
  }
  server = createServer(async (request, response) => {
    const filename = path.resolve(work, 'web', '.' + new URL(request.url, 'http://localhost').pathname);
    if (!filename.startsWith(path.join(work, 'web') + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const body = await readFile(filename);
      response.writeHead(200, { 'content-type': mime(filename), 'content-security-policy': csp });
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const web = {};
  for (const engine of [chromium, firefox]) {
    browser = await engine.launch({ headless: true });
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('Web fixture:', error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${fixturePath}`);
    await page.waitForFunction(() => typeof globalThis.runCloudiniFixture === 'function');
    const result = await page.evaluate(() => globalThis.runCloudiniFixture());
    assert.equal(result.terminated, 1);
    assert.equal(result.javascript_eval_blocked, true, 'WASM permission must not permit JavaScript eval');
    web[engine.name()] = result;
    await browser.close();
    browser = undefined;
  }
  const main = path.join(work, 'main.cjs');
  await writeFile(main, `
    const { app, BrowserWindow, protocol } = require('electron');
    const { readFile } = require('node:fs/promises');
    const path = require('node:path');
    app.disableHardwareAcceleration();
    app.setPath('userData', ${JSON.stringify(path.join(work, 'profile'))});
    protocol.registerSchemesAsPrivileged([{scheme:'app', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
    app.whenReady().then(() => {
      protocol.handle('app', async request => {
        const pathname = new URL(request.url).pathname;
        const file = path.resolve(${JSON.stringify(path.join(work, 'desktop'))}, '.' + pathname);
        if (!file.startsWith(${JSON.stringify(path.join(work, 'desktop') + path.sep)})) return new Response('', {status:404});
        return new Response(await readFile(file), {headers:{'content-type':file.endsWith('.html')?'text/html':'text/javascript',
          'content-security-policy':${JSON.stringify(csp)}}});
      });
      const window = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
      window.loadURL('app://robo-boy${fixturePath}');
    });
  `);
  // This fixture does not draw WebGL. Use Linux's headless display backend so it
  // exercises real packaged URLs/workers without depending on the user's X server.
  electron = await _electron.launch({ args: process.platform === 'linux'
    ? ['--no-sandbox', '--ozone-platform=headless', main] : [main], timeout: 30000 });
  const window = await electron.firstWindow();
  window.on('pageerror', error => console.error('Desktop fixture:', error.message));
  await window.waitForFunction(() => typeof globalThis.runCloudiniFixture === 'function');
  const desktop = await window.evaluate(() => globalThis.runCloudiniFixture());
  assert.deepEqual(desktop.positions, web.chromium.positions);
  assert.deepEqual(desktop.positions, web.firefox.positions);
  assert.equal(desktop.terminated, 1);
  assert.equal(desktop.javascript_eval_blocked, true);
  console.log(JSON.stringify({ web, desktop }, null, 2));
} finally {
  await electron?.close();
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  await rm(work, { recursive: true, force: true });
}
