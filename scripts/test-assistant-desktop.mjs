#!/usr/bin/env node
/** Packaged-ASAR smoke test: isolated profile, fixture ROS/model, real native API IPC.
 * No live provider, real robot, installed user profile or API billing is involved. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { _electron, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appMain = path.resolve(root, process.argv[2] ?? 'release/linux-unpacked/resources/app.asar/dist-electron/shell/main.js');
await stat(path.dirname(path.dirname(path.dirname(appMain))));
const work = await mkdtemp(path.join(tmpdir(), 'robo-boy-agent-smoke-'));
const requests = [], failures = [], errors = [];
let electron;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer desktop-fixture-session');
    let body = '';
    for await (const chunk of request) { body += chunk; assert.ok(body.length < 512 * 1024); }
    const input = JSON.parse(body); requests.push(input);
    assert.ok(input.tools.some(tool => tool.function.name === 'edit_workspace'));
    const round = requests.length;
    const delta = round === 1 ? { tool_calls: [{ index: 0, id: 'workspace-call', type: 'function', function: { name: 'edit_workspace', arguments: JSON.stringify({ operations: [{ op: 'addPanel', panelType: 'behaviorTree' }] }) } }] }
      : round === 2 ? { tool_calls: [{ index: 0, id: 'verify-call', type: 'function', function: { name: 'read_workspace', arguments: '{}' } }] }
        : { content: 'Desktop native tools verified.\n\n**Observed** workspace state:\n\n| Panel | Status |\n| --- | --- |\n| Behavior Tree | Open |\n\n```json\n{"robotExecuted":false}\n```' };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta, finish_reason: round < 3 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`);
  } catch (cause) { failures.push(String(cause)); response.writeHead(500).end('Desktop fixture failed.'); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const bootstrap = path.join(work, 'main.mjs');
  await writeFile(bootstrap, `import { app } from 'electron';\napp.setPath('userData', ${JSON.stringify(path.join(work, 'profile'))});\nawait import(${JSON.stringify(pathToFileURL(appMain).href)});\n`);
  const helper = path.join(work, 'rosMock.mjs');
  await build({ entryPoints: [path.join(root, 'e2e/helpers/rosMock.ts')], outfile: helper, bundle: true, platform: 'node', format: 'esm', target: 'node22' });
  const { installRosMock } = await import(pathToFileURL(helper).href);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ROBOBOY_DEV_SERVER_URL;
  electron = await _electron.launch({ args: [bootstrap, '--no-sandbox', ...(!env.DISPLAY && !env.WAYLAND_DISPLAY ? ['--ozone-platform=headless'] : [])], env, timeout: 60_000 });
  const page = await electron.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  assert.equal(await electron.evaluate(({ app }) => app.getPath('userData')), path.join(work, 'profile'));
  await installRosMock(page, { topics: [], services: [], actionServers: [], parameters: {} });
  await page.evaluate(async baseUrl => {
    await window.roboBoyDesktop.assistant.setApiKey('openai-compatible', 'desktop-fixture-session', 'session');
    localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai-compatible', authMode: 'api-key', baseUrl, model: 'fixture', apiKey: '', mode: 'agent' }));
  }, baseUrl);
  await page.reload();
  if (await page.getByTitle('Advanced Options').count()) await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Add a Behavior Tree panel and verify the workspace.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Desktop native tools verified.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('assistant-panel').getByRole('table')).toBeVisible();
  assert.equal(await page.getByText('Observed', { exact: true }).evaluate(element => element.tagName), 'STRONG');
  await expect(page.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
  assert.equal(requests.length, 3); assert.deepEqual(failures, []); assert.deepEqual(errors, []);
  assert.equal(requests[2].messages.filter(message => message.role === 'user').length, 1);
  assert.ok(requests[2].messages.some(message => message.role === 'tool' && message.tool_call_id === 'workspace-call'));
  assert.ok(JSON.stringify(requests[2].messages).includes('behaviorTree'));
  assert.equal(await page.locator('.assistant-message.user').count(), 1);
  const commands = await page.evaluate(() => window.__getRosCommands());
  assert.ok(!commands.some(command => command.op === 'send_action_goal' || command.op === 'call_service' && !command.service.startsWith('/rosapi/')));
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/assistant-desktop-native.png') });
  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    await page.evaluate(() => window.roboBoyDesktop.assistant.setBackgroundActive(true));
    await page.evaluate(() => window.roboBoyDesktop.window.close());
    await expect.poll(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await page.evaluate(() => window.roboBoyDesktop.assistant.setBackgroundActive(false));
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    console.log('PASS tray hide-on-close');
  } else console.log('SKIP native tray UI: no display (headless native inference still tested)');
  console.log('PASS packaged ASAR startup, native credentials/tool IPC, read-after-write, Markdown/table rendering, isolated profile and zero robot execution');
} finally {
  await electron?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // Only the mkdtemp-owned fixture/profile above is removed.
  await rm(work, { recursive: true, force: true });
}
