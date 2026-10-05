import { safeStorage } from 'electron';
import type { ApiKeyStoragePolicy, ApiKeyStorageState } from '../src/runtime/assistantSubscription';
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
  await writePrivateRecord(directory, filename, safeStorage.encryptString(JSON.stringify(value)));
}

/** App-owned records need no keychain. Atomic writes preserve the last saved value on failure. */
async function writePrivateRecord(directory: string, filename: string, contents: Buffer | string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  const temporary = join(directory, `${filename}-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(contents);
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
const SESSION_WARNING =
  'Secure storage is unavailable. This key works for this app session. To remember it without a keychain, choose Save unencrypted on this device.';
interface KeyRecord {
  policy: ApiKeyStoragePolicy;
  storage: 'encrypted' | 'plaintext' | 'session';
  value: string;
}
type KeyRecords = Record<string, KeyRecord>;

/** Bound native work without letting late completion write a stale credential. */
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Credential store timed out.')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export class AssistantApiKeys {
  private queue: Promise<unknown> = Promise.resolve();
  private memory = new Map<string, string>();
  private states = new Map<string, ApiKeyStorageState>();
  private availability?: Promise<boolean>;
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
  private policy(value: unknown): ApiKeyStoragePolicy {
    if (value !== 'automatic' && value !== 'session' && value !== 'local')
      throw new Error('Invalid API-key storage policy.');
    return value;
  }
  private async secureAvailable(): Promise<boolean> {
    // Use the asynchronous API; synchronous availability checks can also block on a keychain.
    // Once unavailable, do not repeatedly summon OS UI on every keystroke or provider switch.
    this.availability ??= bounded(
      (async () => {
        if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
        if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
        return (
          process.platform !== 'linux' ||
          ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
        );
      })()
    ).catch(() => false);
    return this.availability;
  }
  private async encrypt(key: string): Promise<string | undefined> {
    if (!(await this.secureAvailable())) return undefined;
    try {
      return (await bounded(safeStorage.encryptStringAsync(key))).toString('base64');
    } catch {
      this.availability = Promise.resolve(false);
      return undefined;
    }
  }
  private async decrypt(value: Buffer): Promise<string> {
    if (!(await this.secureAvailable())) throw new Error(SESSION_WARNING);
    try {
      return (await bounded(safeStorage.decryptStringAsync(value))).result;
    } catch {
      this.availability = Promise.resolve(false);
      throw new Error(
        'Cannot unlock the saved API key. Enter it again to use it for this session. The encrypted record is preserved.'
      );
    }
  }
  private validateLegacy(value: any): Record<string, string> {
    if (
      value?.version !== 1 ||
      !value.keys ||
      typeof value.keys !== 'object' ||
      Array.isArray(value.keys) ||
      Object.entries(value.keys).some(
        ([provider, key]) => !PROVIDERS.includes(provider) || typeof key !== 'string' || key.length > 16384
      )
    )
      throw new Error('Invalid saved assistant API keys. The existing record has been preserved.');
    return value.keys;
  }
  private async load(): Promise<KeyRecords> {
    let value: any;
    try {
      value = JSON.parse(await readFile(join(this.directory, 'api-keys.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new Error('Cannot read the saved assistant API keys. The existing record has been preserved.');
    }
    if (value?.version === 1) {
      return Object.fromEntries(
        Object.entries(this.validateLegacy(value)).map(([provider, key]) => [
          provider,
          { policy: 'automatic', storage: 'plaintext', value: key },
        ])
      );
    }
    if (
      value?.version !== 2 ||
      !value.keys ||
      typeof value.keys !== 'object' ||
      Array.isArray(value.keys) ||
      Object.entries(value.keys).some(([provider, entry]) => {
        const record = entry as KeyRecord;
        return (
          !PROVIDERS.includes(provider) ||
          !record ||
          !['automatic', 'session', 'local'].includes(record.policy) ||
          !['encrypted', 'plaintext', 'session'].includes(record.storage) ||
          typeof record.value !== 'string' ||
          record.value.length > (record.storage === 'encrypted' ? 131072 : 16384) ||
          (record.storage === 'session' && record.value !== '') ||
          (record.storage === 'encrypted' &&
            (record.policy !== 'automatic' || !/^[A-Za-z0-9+/]+={0,2}$/.test(record.value))) ||
          (record.policy === 'session' && record.storage !== 'session') ||
          (record.policy === 'local' && record.storage !== 'plaintext')
        );
      })
    )
      throw new Error('Invalid saved assistant API keys. The existing record has been preserved.');
    return value.keys;
  }
  private save(keys: KeyRecords): Promise<void> {
    return writePrivateRecord(this.directory, 'api-keys.json', JSON.stringify({ version: 2, keys }));
  }
  getStorage(value: unknown): Promise<ApiKeyStorageState> {
    const provider = this.provider(value);
    return this.exclusive(async () => this.states.get(provider) ?? { policy: 'automatic', storage: 'none' });
  }
  get(value: unknown): Promise<string | undefined> {
    const provider = this.provider(value);
    return this.exclusive(async () => {
      if (this.memory.has(provider)) return this.memory.get(provider);
      const keys = await this.load();
      let record = keys[provider];
      if (!record) {
        let old: Buffer;
        try {
          old = await readFile(join(this.directory, 'api-keys.bin'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            this.states.set(provider, { policy: 'automatic', storage: 'none' });
            return undefined;
          }
          throw new Error('Cannot read the saved assistant API keys. The existing record has been preserved.');
        }
        const decrypted = await this.decrypt(old);
        let legacy: unknown;
        try {
          legacy = JSON.parse(decrypted);
        } catch {
          throw new Error('Invalid saved assistant API keys. The existing record has been preserved.');
        }
        const key = this.validateLegacy(legacy)[provider];
        if (key === undefined) return undefined;
        // Import only this provider. Other legacy providers remain recoverable in the old file.
        const encrypted = key ? await this.encrypt(key) : undefined;
        if (key && !encrypted) {
          this.memory.set(provider, key);
          this.states.set(provider, { policy: 'automatic', storage: 'session', warning: SESSION_WARNING });
          return key;
        }
        record = { policy: 'automatic', storage: encrypted ? 'encrypted' : 'session', value: encrypted ?? '' };
        keys[provider] = record;
        let warning: string | undefined;
        try {
          await this.save(keys);
        } catch {
          warning =
            'The saved encrypted key could not be migrated. The previous record is preserved and this key remains usable.';
        }
        this.memory.set(provider, key);
        this.states.set(provider, {
          policy: 'automatic',
          storage: key ? 'encrypted' : 'session',
          ...(warning ? { warning } : {}),
        });
        return key;
      }
      if (record.storage === 'session') {
        this.states.set(provider, { policy: record.policy, storage: 'session' });
        return '';
      }
      let key = record.value;
      let warning: string | undefined;
      if (record.storage === 'encrypted') {
        key = await this.decrypt(Buffer.from(record.value, 'base64'));
        if (key.length > 16384) throw new Error('Invalid saved assistant API key.');
      } else if (record.policy === 'automatic' && key) {
        // Upgrade existing plaintext records automatically when possible. If unavailable,
        // preserve the previous persisted key until the user chooses a different policy.
        const encrypted = await this.encrypt(key);
        if (encrypted) {
          const upgraded: KeyRecord = { policy: 'automatic', storage: 'encrypted', value: encrypted };
          keys[provider] = upgraded;
          try {
            await this.save(keys);
            record = upgraded;
          } catch {
            warning =
              'This existing key is still saved unencrypted because the storage upgrade failed. The previous record is preserved and the key remains usable.';
          }
        }
      }
      this.states.set(provider, {
        policy: record.policy,
        storage: record.storage,
        ...(record.storage === 'plaintext'
          ? {
              warning:
                warning ??
                (record.policy === 'automatic'
                  ? 'An existing key is saved unencrypted and secure storage is unavailable. Choose This session only to remove the saved secret, or Save unencrypted on this device to keep this behavior.'
                  : 'Saved unencrypted on this device. Someone with access to your app files or backups can read this key.'),
            }
          : {}),
      });
      this.memory.set(provider, key);
      return key;
    });
  }
  set(value: unknown, key: unknown, requestedPolicy?: unknown): Promise<ApiKeyStorageState> {
    const provider = this.provider(value);
    if (typeof key !== 'string' || key.length > 16384) throw new Error('Invalid assistant API key.');
    const policy = requestedPolicy === undefined ? undefined : this.policy(requestedPolicy);
    return this.exclusive(async () => {
      // A disk failure must not prevent use of the freshly entered key during this session.
      this.memory.set(provider, key);
      this.states.set(provider, {
        policy: policy ?? this.states.get(provider)?.policy ?? 'automatic',
        storage: 'session',
        warning: 'This key works for this session but could not be saved.',
      });
      const keys = await this.load();
      const selected = policy ?? keys[provider]?.policy ?? 'automatic';
      const encrypted = selected === 'automatic' && key ? await this.encrypt(key) : undefined;
      const record: KeyRecord = {
        policy: selected,
        storage: selected === 'local' ? 'plaintext' : encrypted ? 'encrypted' : 'session',
        value: selected === 'local' ? key : (encrypted ?? ''),
      };
      // Empty/session markers prevent older native or browser keys from resurfacing after restart.
      keys[provider] = record;
      await this.save(keys);
      const state: ApiKeyStorageState = {
        policy: selected,
        storage: record.storage,
        ...(key && selected === 'automatic' && !encrypted ? { warning: SESSION_WARNING } : {}),
        ...(key && selected === 'local'
          ? {
              warning:
                'Saved unencrypted on this device. Someone with access to your app files or backups can read this key.',
            }
          : {}),
      };
      this.states.set(provider, state);
      return state;
    });
  }
}
