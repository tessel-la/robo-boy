#!/usr/bin/env node
/**
 * Runs the Electron shell against the Vite dev server.
 *
 * Vite is started first and Electron waits for it to answer, because a window that opens against
 * a server which is not listening yet loads nothing and stays blank. Both are stopped together,
 * so closing the window does not leave a dev server behind holding the port.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.FRONTEND_PORT ?? '5173';
const devServerUrl = `http://localhost:${port}/`;

const children = [];
let shuttingDown = false;

const stopAll = code => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
};

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const run = (command, args, env) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  children.push(child);
  return child;
};

const waitForServer = async (url, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'HEAD' });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`The dev server did not come up at ${url} within ${timeoutMs}ms.`);
};

const vite = run('npm', ['run', 'dev:electron:renderer']);
vite.on('exit', code => stopAll(code ?? 0));

await waitForServer(devServerUrl);

// The shell is compiled before each run; it is two files, so this costs nothing worth saving.
const shell = run('node', ['scripts/build-electron-shell.mjs']);
await new Promise((resolve, reject) => {
  shell.on('exit', code => (code === 0 ? resolve() : reject(new Error('The Electron shell failed to compile.'))));
});

const electron = run('npx', ['electron', 'dist-electron/shell/main.js'], {
  ROBOBOY_DEV_SERVER_URL: devServerUrl,
});
electron.on('exit', code => stopAll(code ?? 0));
