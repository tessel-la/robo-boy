// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
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
  it('encrypts records, preserves concurrent provider updates, restores after restart and deletes cleared keys', async () => {
    await chmod(directory, 0o755);
    await Promise.all([keys.set('openai', 'openai-secret'), keys.set('anthropic', 'claude-secret')]);
    const file = join(directory, 'api-keys.bin');
    expect((await readFile(file)).toString()).not.toContain('secret');
    expect(storage.encryptString).toHaveBeenCalled();
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
    expect(await new AssistantApiKeys(directory).get('openai')).toBe('openai-secret');
    expect(await keys.get('anthropic')).toBe('claude-secret');
    await keys.set('openai', '');
    expect(await keys.get('openai')).toBe('');
    expect(await readdir(directory)).toEqual(['api-keys.bin']);
  });
  it('fails closed when the OS keyring is unavailable or uses Linux plaintext fallback', async () => {
    storage.isEncryptionAvailable.mockReturnValue(false);
    await expect(keys.set('openai', 'secret')).rejects.toThrow(/OS credential store/);
    expect(await readdir(directory)).toEqual([]);
    if (process.platform === 'linux') {
      storage.isEncryptionAvailable.mockReturnValue(true);
      storage.getSelectedStorageBackend.mockReturnValue('basic_text');
      await expect(keys.set('openai', 'secret')).rejects.toThrow(/OS credential store/);
    }
  });
  it('rejects invalid providers, oversized keys and damaged encrypted records', async () => {
    expect(() => keys.get('../accounts')).toThrow();
    expect(() => keys.set('openai', 'x'.repeat(16385))).toThrow();
    await keys.set('openai', 'secret');
    storage.decryptString.mockImplementationOnce(() => '{broken');
    await expect(keys.get('openai')).rejects.toThrow(/Cannot unlock/);
  });
});
