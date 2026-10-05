// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantApiKeys } from './assistantStorage';

const storage = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptStringAsync: vi.fn(async (text: string) => Buffer.from(Buffer.from(text).toString('base64'))),
  decryptStringAsync: vi.fn(async (buffer: Buffer) => ({
    result: Buffer.from(buffer.toString(), 'base64').toString(),
    shouldReEncrypt: false,
  })),
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}));
const disk = vi.hoisted(() => ({ rejectRename: false }));
vi.mock('electron', () => ({ safeStorage: storage }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (disk.rejectRename) throw new Error('Disk write failed');
      return fs.rename(...args);
    },
  };
});

describe('native API-key persistence', () => {
  let directory: string, keys: AssistantApiKeys;
  const record = () => readFile(join(directory, 'api-keys.json'), 'utf8');
  beforeEach(async () => {
    vi.resetAllMocks();
    disk.rejectRename = false;
    storage.isAsyncEncryptionAvailable.mockResolvedValue(true);
    storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    storage.encryptStringAsync.mockImplementation(async text => Buffer.from(Buffer.from(text).toString('base64')));
    storage.decryptStringAsync.mockImplementation(async buffer => ({
      result: Buffer.from(buffer.toString(), 'base64').toString(),
      shouldReEncrypt: false,
    }));
    directory = await mkdtemp(join(tmpdir(), 'roboboy-key-test-'));
    keys = new AssistantApiKeys(directory);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });
  it('encrypts concurrent provider updates, restores after restart and clears without reviving older keys', async () => {
    await chmod(directory, 0o755);
    await Promise.all([keys.set('openai', 'openai-secret'), keys.set('anthropic', 'claude-secret')]);
    expect(await record()).not.toContain('openai-secret');
    expect(await record()).not.toContain('claude-secret');
    expect(await keys.getStorage('openai')).toEqual({ policy: 'automatic', storage: 'encrypted' });
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.encryptString).not.toHaveBeenCalled();
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, 'api-keys.json'))).mode & 0o777).toBe(0o600);
    }
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('openai-secret');
    expect(await keys.get('anthropic')).toBe('claude-secret');
    await writeFile(join(directory, 'api-keys.bin'), 'stale-encrypted-record');
    await keys.set('openai', '');
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('');
    expect(await readdir(directory)).toEqual(['api-keys.bin', 'api-keys.json']);
  });
  it.each(['unavailable', 'basic_text', 'encryption rejected', 'probe rejected'])(
    'uses session memory without silently writing plaintext (%s)',
    async failure => {
      if (failure === 'unavailable') storage.isAsyncEncryptionAvailable.mockResolvedValue(false);
      if (failure === 'basic_text') {
        if (process.platform !== 'linux') return;
        storage.getSelectedStorageBackend.mockReturnValue('basic_text');
      }
      if (failure === 'encryption rejected') storage.encryptStringAsync.mockRejectedValue(new Error('locked'));
      if (failure === 'probe rejected') storage.isAsyncEncryptionAvailable.mockRejectedValue(new Error('locked'));
      const state = await keys.set('openai', 'session-secret');
      expect(state).toMatchObject({
        policy: 'automatic',
        storage: 'session',
        warning: expect.stringContaining('This key works'),
      });
      expect(await keys.get('openai')).toBe('session-secret');
      expect(await record()).not.toContain('session-secret');
      expect(await new AssistantApiKeys(directory).get('openai')).toBe('');
    }
  );
  it('bounds a hung keychain and ignores late native completion', async () => {
    let finish!: (available: boolean) => void;
    storage.isAsyncEncryptionAvailable.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    // Let the filesystem read complete before advancing the native timeout.
    const pending = keys.set('openai', 'session-secret');
    await vi.waitFor(() => expect(finish).toBeDefined());
    // The timeout is real here; it exercises the serialized queue as well.
    expect(await pending).toMatchObject({ storage: 'session' });
    finish(true);
    await keys.set('anthropic', 'other-secret');
    expect(await record()).not.toContain('secret');
    expect(storage.encryptStringAsync).not.toHaveBeenCalled();
  });
  it('explicit local and session policies never touch the keychain and remain selected after restart', async () => {
    expect(await keys.set('openai', 'local-secret', 'local')).toMatchObject({ policy: 'local', storage: 'plaintext' });
    expect(await record()).toContain('local-secret');
    const restored = new AssistantApiKeys(directory);
    expect(await restored.get('openai')).toBe('local-secret');
    await restored.set('openai', 'updated-secret');
    expect(await record()).toContain('updated-secret');
    await restored.set('openai', 'session-secret', 'session');
    expect(await restored.get('openai')).toBe('session-secret');
    expect(await record()).not.toContain('secret');
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('');
    expect(storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
  it('upgrades existing local keys to encryption and preserves explicit clearing and other providers', async () => {
    await writeFile(
      join(directory, 'api-keys.json'),
      JSON.stringify({ version: 1, keys: { openai: 'old-secret', anthropic: 'other-secret', gemini: '' } })
    );
    expect(await keys.get('openai')).toBe('old-secret');
    expect(await record()).not.toContain('old-secret');
    expect(await keys.getStorage('openai')).toMatchObject({ storage: 'encrypted' });
    expect(await keys.get('anthropic')).toBe('other-secret');
    expect(await keys.get('gemini')).toBe('');
  });
  it('preserves a pre-existing plaintext key when secure storage cannot upgrade it, and exposes the disclosure', async () => {
    storage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const original = JSON.stringify({ version: 1, keys: { openai: 'old-secret' } });
    await writeFile(join(directory, 'api-keys.json'), original);
    expect(await keys.get('openai')).toBe('old-secret');
    expect(await keys.getStorage('openai')).toMatchObject({
      storage: 'plaintext',
      warning: expect.stringContaining('existing key'),
    });
    expect(await record()).toBe(original);
    await keys.set('openai', 'old-secret', 'session');
    expect(await record()).not.toContain('old-secret');
  });
  it('recovers legacy encrypted keys, but new and cleared records take precedence', async () => {
    const old = await storage.encryptStringAsync(
      JSON.stringify({ version: 1, keys: { openai: 'legacy-secret', anthropic: 'claude-secret' } })
    );
    await writeFile(join(directory, 'api-keys.bin'), old);
    expect(await keys.get('openai')).toBe('legacy-secret');
    expect(await record()).not.toContain('legacy-secret');
    expect(await keys.get('anthropic')).toBe('claude-secret');
    await keys.set('openai', '');
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('');
    expect(await readFile(join(directory, 'api-keys.bin'))).toEqual(old);
  });
  it('preserves locked encrypted credentials until explicit replacement, without downgrading them', async () => {
    await keys.set('openai', 'secret');
    const original = await record();
    storage.decryptStringAsync.mockRejectedValue(new Error('locked'));
    const restored = new AssistantApiKeys(directory);
    await expect(restored.get('openai')).rejects.toThrow(/Enter it again/);
    expect(await record()).toBe(original);
    expect(await restored.set('openai', 'replacement')).toMatchObject({ storage: 'session' });
    expect(await restored.get('openai')).toBe('replacement');
    expect(await record()).not.toContain('replacement');
  });
  it('retains a usable session key on disk failure, rejects invalid input and never overwrites damaged records', async () => {
    expect(() => keys.get('../accounts')).toThrow();
    expect(() => keys.set('openai', 'x'.repeat(16385))).toThrow();
    expect(() => keys.set('openai', 'secret', 'unsafe')).toThrow(/policy/);
    await writeFile(join(directory, 'api-keys.json'), '{broken');
    await expect(keys.get('openai')).rejects.toThrow(/preserved/);
    await expect(keys.set('openai', 'replacement')).rejects.toThrow(/preserved/);
    expect(await keys.get('openai')).toBe('replacement');
    expect(await record()).toBe('{broken');
  });
  it('keeps a loaded key usable if its encryption upgrade cannot be written', async () => {
    const original = JSON.stringify({ version: 1, keys: { openai: 'old-secret' } });
    await writeFile(join(directory, 'api-keys.json'), original);
    disk.rejectRename = true;
    expect(await keys.get('openai')).toBe('old-secret');
    expect(await keys.getStorage('openai')).toMatchObject({
      storage: 'plaintext',
      warning: expect.stringContaining('upgrade failed'),
    });
    expect(await record()).toBe(original);
    expect(await readdir(directory)).toEqual(['api-keys.json']);
  });
  it('retains the previous disk record and usable replacement when atomic commit fails', async () => {
    await keys.set('openai', 'previous-secret');
    const original = await record();
    disk.rejectRename = true;
    await expect(keys.set('openai', 'replacement-secret')).rejects.toThrow('Disk write failed');
    expect(await keys.get('openai')).toBe('replacement-secret');
    expect(await keys.getStorage('openai')).toMatchObject({ storage: 'session' });
    expect(await record()).toBe(original);
    expect(await readdir(directory)).toEqual(['api-keys.json']);
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('previous-secret');
  });
  it('round-trips the maximum supported Unicode key through encrypted storage', async () => {
    const key = '密'.repeat(16384);
    await keys.set('openai', key);
    expect(await new AssistantApiKeys(directory).get('openai')).toBe(key);
  });
  it('does not expose decrypted legacy contents in a malformed-record error', async () => {
    await writeFile(join(directory, 'api-keys.bin'), await storage.encryptStringAsync('sensitive-secret-not-json'));
    await expect(keys.get('openai')).rejects.toThrow(
      'Invalid saved assistant API keys. The existing record has been preserved.'
    );
    expect(await readdir(directory)).toEqual(['api-keys.bin']);
  });
});
