// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantApiKeys } from './assistantStorage';

const storage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret'),
  encryptString: vi.fn((text: string) => Buffer.from(Buffer.from(text).toString('base64'))),
  decryptString: vi.fn((buffer: Buffer) => Buffer.from(buffer.toString(), 'base64').toString()),
}));
vi.mock('electron', () => ({ safeStorage: storage }));

describe('native API-key persistence', () => {
  let directory: string, keys: AssistantApiKeys;
  beforeEach(async () => {
    vi.clearAllMocks();
    storage.isEncryptionAvailable.mockReturnValue(true);
    storage.getSelectedStorageBackend.mockReturnValue('gnome_libsecret');
    directory = await mkdtemp(join(tmpdir(), 'roboboy-key-test-'));
    keys = new AssistantApiKeys(directory);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('saves locally without a keychain, preserves concurrent updates, restores after restart and clears keys', async () => {
    await chmod(directory, 0o755);
    await Promise.all([keys.set('openai', 'openai-secret'), keys.set('anthropic', 'claude-secret')]);
    const file = join(directory, 'api-keys.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      keys: { openai: 'openai-secret', anthropic: 'claude-secret' },
    });
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('openai-secret');
    expect(await keys.get('anthropic')).toBe('claude-secret');
    await keys.set('openai', '');
    expect(await keys.get('openai')).toBe('');
    expect(await readdir(directory)).toEqual(['api-keys.json']);
  });
  it('works when the OS keyring is unavailable or uses Linux plaintext fallback', async () => {
    storage.isEncryptionAvailable.mockReturnValue(false);
    storage.getSelectedStorageBackend.mockReturnValue('basic_text');
    await keys.set('openai', 'secret');
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('secret');
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
  it('preserves old encrypted keys without unlocking them and lets explicit re-entry take precedence', async () => {
    const oldFile = join(directory, 'api-keys.bin');
    await writeFile(oldFile, 'old-encrypted-record');
    await expect(keys.get('openai')).rejects.toThrow(/Enter the key once again/);
    await keys.set('openai', 'new-secret');
    expect(await keys.get('openai')).toBe('new-secret');
    await keys.set('anthropic', '');
    expect(await keys.get('anthropic')).toBe('');
    expect(await readFile(oldFile, 'utf8')).toBe('old-encrypted-record');
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
  });
  it('rejects invalid providers, oversized keys and damaged records without overwriting them', async () => {
    expect(() => keys.get('../accounts')).toThrow();
    expect(() => keys.set('openai', 'x'.repeat(16385))).toThrow();
    await keys.set('openai', 'secret');
    const file = join(directory, 'api-keys.json');
    await writeFile(file, '{broken');
    await expect(keys.get('openai')).rejects.toThrow(/existing record has been preserved/);
    await expect(keys.set('openai', 'replacement')).rejects.toThrow(/existing record has been preserved/);
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });
});
