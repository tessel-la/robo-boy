/** Bounded, single-writer session snapshots. Credentials are hashed before reaching this layer. */
import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import lockfile from 'proper-lockfile';

export class SessionStoreError extends Error {
  constructor() {
    super('Session storage is unavailable. Check its permissions, available space, and gateway ownership.');
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = session => ({
  key: session.key,
  mediaKey: session.mediaKey,
  user: { id: session.user.id, name: session.user.name },
  provider: session.provider,
  expires: session.expires,
});
const validRecord = value =>
  value && digest(value.key) && digest(value.mediaKey) &&
  typeof value.user?.id === 'string' && value.user.id.length > 0 && value.user.id.length <= 512 &&
  typeof value.user.name === 'string' && value.user.name.length <= 128 &&
  typeof value.provider === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value.provider) &&
  Number.isSafeInteger(value.expires) && value.expires > 0;

/** No file means the existing memory-only behavior, useful for isolated tests and development. */
export async function openSessionStore({ file, policy, clock = Date.now, onFailure = () => {} }) {
  let failed = false;
  const fail = () => {
    failed = true;
    onFailure();
    return new SessionStoreError();
  };
  if (!file) return { sessions: [], get failed() { return failed; }, save() {}, async close() {} };
  const path = resolve(file);
  const directory = dirname(path);
  let release;
  let closed = false;
  const checkPrivate = (path, directory = false) => {
    const info = lstatSync(path);
    if (
      (directory ? !info.isDirectory() : !info.isFile()) ||
      (info.mode & (directory ? 0o022 : 0o077)) ||
      (process.getuid && info.uid !== process.getuid())
    ) throw new SessionStoreError();
    return info;
  };
  const save = sessions => {
    if (failed || closed) throw new SessionStoreError();
    const records = sessions.map(record);
    if (records.length > 1024 || records.some(value => !validRecord(value))) throw fail();
    const data = JSON.stringify({ version: 1, policy, sessions: records });
    if (Buffer.byteLength(data) > MAX_BYTES) throw fail();
    const temporary = resolve(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    let descriptor;
    try {
      checkPrivate(directory, true);
      // A unique private file and atomic replacement keep a killed writer from leaving partial JSON.
      descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      writeFileSync(descriptor, data);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, path);
      descriptor = openSync(directory, constants.O_RDONLY);
      fsyncSync(descriptor);
    } catch {
      throw fail();
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* Renamed or never created. */ }
    }
  };
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    checkPrivate(directory, true);
    release = await lockfile.lock(path, {
      realpath: false,
      stale: 10000,
      update: 2000,
      onCompromised: () => { fail(); },
    });
    let sessions = [];
    try {
      if (checkPrivate(path).size > MAX_BYTES) throw new SessionStoreError();
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (
        saved.version !== 1 || !digest(saved.policy) || !Array.isArray(saved.sessions) ||
        saved.sessions.length > 1024 || saved.sessions.some(value => !validRecord(value)) ||
        new Set(saved.sessions.map(value => value.key)).size !== saved.sessions.length ||
        new Set(saved.sessions.map(value => value.mediaKey)).size !== saved.sessions.length
      ) throw new SessionStoreError();
      if (saved.policy === policy) sessions = saved.sessions.filter(value => value.expires > clock()).map(record);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Remove expired records and permanently invalidate records from a changed access policy.
    save(sessions);
    return {
      sessions,
      get failed() { return failed; },
      save,
      close: async () => {
        if (closed) return;
        closed = true;
        if (!failed) await release(); else await release().catch(() => {});
      },
    };
  } catch {
    if (release) await release().catch(() => {});
    throw new SessionStoreError();
  }
}
