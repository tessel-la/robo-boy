import { safeStorage } from 'electron';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function requireSecureStorage(): void {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error(
      'Credential storage needs an OS credential store. Unlock or enable your system keyring and restart Robo-Boy.'
    );
  }
}

export async function readEncryptedJson(directory: string, filename: string): Promise<unknown> {
  let encrypted: Buffer;
  try {
    encrypted = await readFile(join(directory, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read the saved assistant credentials.');
  }
  requireSecureStorage();
  try {
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    throw new Error('Cannot unlock the saved assistant credentials. Unlock your system keyring and restart Robo-Boy.');
  }
}

/** Atomic, encrypted, owner-only records. Commit memory only after this resolves. */
export async function writeEncryptedJson(directory: string, filename: string, value: unknown): Promise<void> {
  requireSecureStorage();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const temporary = join(directory, `${filename}-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(safeStorage.encryptString(JSON.stringify(value)));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, filename));
  } finally {
    await rm(temporary, { force: true });
  }
}

const PROVIDERS = ['openai', 'anthropic', 'gemini', 'ollama', 'openai-compatible'];
export class AssistantApiKeys {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private provider(value: unknown): string {
    if (typeof value !== 'string' || !PROVIDERS.includes(value)) throw new Error('Invalid API-key provider.');
    return value;
  }
  private async load(): Promise<Record<string, string>> {
    const value = (await readEncryptedJson(this.directory, 'api-keys.bin')) as any;
    if (value === undefined) return {};
    if (
      value?.version !== 1 ||
      !value.keys ||
      typeof value.keys !== 'object' ||
      Array.isArray(value.keys) ||
      Object.entries(value.keys).some(
        ([key, secret]) => !PROVIDERS.includes(key) || typeof secret !== 'string' || secret.length > 16384
      )
    ) {
      throw new Error('Invalid saved assistant API keys.');
    }
    return value.keys;
  }
  get(value: unknown): Promise<string | undefined> {
    const provider = this.provider(value);
    return this.exclusive(async () => (await this.load())[provider]);
  }
  set(value: unknown, key: unknown): Promise<void> {
    const provider = this.provider(value);
    if (typeof key !== 'string' || key.length > 16384) throw new Error('Invalid assistant API key.');
    return this.exclusive(async () => {
      const keys = await this.load();
      // Keep an empty marker so a stale legacy browser entry cannot restore a cleared key.
      keys[provider] = key;
      await writeEncryptedJson(this.directory, 'api-keys.bin', { version: 1, keys });
    });
  }
}
