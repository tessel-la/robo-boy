import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSessionStore, SessionStoreError } from './session-store.mjs';

describe('Private durable session store', () => {
  let directory, file;
  const handles = new Set();
  const policy = 'a'.repeat(64);
  const session = {
    key: 'b'.repeat(64), mediaKey: 'c'.repeat(64), user: { id: 'employee', name: 'Alice' },
    provider: 'company', expires: 2000,
  };
  const open = async (extra = {}) => {
    const store = await openSessionStore({ file, policy, clock: () => 1000, ...extra });
    handles.add(store);
    return store;
  };
  const close = async store => { handles.delete(store); await store.close(); };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'roboboy-session-store-'));
    file = join(directory, 'private', 'sessions.json');
  });
  afterEach(async () => {
    for (const store of handles) await close(store);
    rmSync(directory, { recursive: true, force: true });
  });

  it('commits private snapshots, restores records, and writes no runtime or credential fields', async () => {
    const store = await open();
    store.save([{ ...session, token: 'never-save', media: 'never-save', connections: new Set() }]);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, 'private')).mode & 0o777, 0o700);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /never-save|connections/);
    await close(store);
    assert.deepEqual((await open()).sessions, [session]);
  });

  it('rejects a second writer and releases ownership on shutdown', async () => {
    const store = await open();
    await assert.rejects(open(), SessionStoreError);
    await close(store);
    await open();
  });

  it('recovers a stale crash lock without discarding sessions', async () => {
    const store = await open();
    store.save([session]);
    await close(store);
    // Simulate the abandoned lease left by a killed process without waiting ten seconds.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(file + '.lock');
    const stale = new Date(Date.now() - 20000);
    utimesSync(file + '.lock', stale, stale);
    assert.deepEqual((await open()).sessions, [session]);
  });

  it('commits before an abrupt process kill and recovers the abandoned writer lease', { timeout: 10000 }, async () => {
    const writer = spawn(process.execPath, [fileURLToPath(new URL('./test/session-writer.mjs', import.meta.url)), file]);
    try {
      await once(writer.stdout, 'data');
      const stopped = once(writer, 'exit');
      writer.kill('SIGKILL');
      await stopped;
      await assert.rejects(open(), SessionStoreError);
      // Age the real orphaned lock deterministically instead of waiting for its ten-second lease.
      const stale = new Date(Date.now() - 20000);
      utimesSync(file + '.lock', stale, stale);
      const store = await open({ clock: () => Date.now() });
      assert.equal(store.sessions[0].user.id, 'crash-test');
    } finally {
      writer.kill('SIGKILL');
    }
  });

  it('fences access when the writer lock is compromised', { timeout: 6000 }, async () => {
    let notify;
    const failure = new Promise(resolve => { notify = resolve; });
    const store = await open({ onFailure: notify });
    rmSync(file + '.lock', { recursive: true });
    // The production lease heartbeat deliberately does not keep a stopped server alive.
    const keepAlive = setInterval(() => {}, 1000);
    try { await failure; } finally { clearInterval(keepAlive); }
    assert.equal(store.failed, true);
    assert.throws(() => store.save([session]), SessionStoreError);
  });

  it('prunes expired records and permanently invalidates sessions after policy changes', async () => {
    let store = await open();
    store.save([session]);
    await close(store);
    store = await open({ clock: () => 2000 });
    assert.deepEqual(store.sessions, []);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).sessions, []);
    store.save([session]);
    await close(store);
    store = await open({ policy: 'd'.repeat(64) });
    assert.deepEqual(store.sessions, []);
    await close(store);
    assert.deepEqual((await open()).sessions, []);
  });

  it('fails closed on corrupt, oversized, unsafe or duplicate records', async () => {
    const store = await open();
    await close(store);
    for (const data of [
      '{unfinished',
      JSON.stringify({ version: 2, policy, sessions: [] }),
      JSON.stringify({ version: 1, policy, sessions: [{ ...session, key: 'raw-credential' }] }),
      JSON.stringify({ version: 1, policy, sessions: [session, session] }),
      ' '.repeat(8 * 1024 * 1024 + 1),
    ]) {
      writeFileSync(file, data);
      await assert.rejects(open(), SessionStoreError);
    }
  });

  it('rejects loose permissions and symlinks instead of opening an unsafe store', async () => {
    const store = await open();
    await close(store);
    chmodSync(file, 0o644);
    await assert.rejects(open(), SessionStoreError);
    chmodSync(file, 0o600);
    chmodSync(join(directory, 'private'), 0o777);
    await assert.rejects(open(), SessionStoreError);
    chmodSync(join(directory, 'private'), 0o700);
    const target = join(directory, 'target');
    writeFileSync(target, readFileSync(file), { mode: 0o600 });
    rmSync(file);
    symlinkSync(target, file);
    await assert.rejects(open(), SessionStoreError);
  });

  it('fences further writes and reports failure when a commit cannot complete', async () => {
    let failures = 0;
    const store = await open({ onFailure: () => failures++ });
    rmSync(join(directory, 'private'), { recursive: true });
    writeFileSync(join(directory, 'private'), 'not a directory');
    assert.throws(() => store.save([session]), SessionStoreError);
    assert.equal(store.failed, true);
    assert.equal(failures, 1);
    assert.throws(() => store.save([]), SessionStoreError);
  });
});
