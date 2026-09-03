/**
 * Storage for panels the desktop shell installs on its own. The packaged app has no reverse
 * proxy to serve `/panels`, so it keeps the registry and bundle sources in its own webview
 * storage and serves them through {@link createLocalPanelFetcher}.
 */
export interface LocalPanelStore {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(): Promise<string[]>;
}

export const LOCAL_PANEL_REGISTRY_PATH = 'installed.json';

/** Synthetic origin for locally installed panels; never resolved over the network. */
export const LOCAL_PANEL_ORIGIN = 'https://panels.robo-boy.localhost';

export const LOCAL_PANEL_REGISTRY_URL = `${LOCAL_PANEL_ORIGIN}/${LOCAL_PANEL_REGISTRY_PATH}`;

export const createMemoryPanelStore = (initial: Record<string, string> = {}): LocalPanelStore => {
  const entries = new Map(Object.entries(initial));
  return {
    read: async path => entries.get(path) ?? null,
    write: async (path, contents) => void entries.set(path, contents),
    remove: async path => void entries.delete(path),
    list: async () => [...entries.keys()],
  };
};

const DATABASE_NAME = 'robo-boy-panels';
const STORE_NAME = 'files';

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Panel storage is unavailable.'));
  });

const runRequest = <T>(database: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> =>
  new Promise((resolve, reject) => {
    const request = run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('Panel storage request failed.'));
  });

export const createIndexedDbPanelStore = (): LocalPanelStore => {
  let database: Promise<IDBDatabase> | null = null;
  const connect = () => (database ??= openDatabase());

  return {
    read: async path => (await runRequest<string | undefined>(await connect(), 'readonly', store => store.get(path))) ?? null,
    write: async (path, contents) => {
      await runRequest(await connect(), 'readwrite', store => store.put(contents, path));
    },
    remove: async path => {
      await runRequest(await connect(), 'readwrite', store => store.delete(path));
    },
    list: async () => (await runRequest<string[]>(await connect(), 'readonly', store => store.getAllKeys())).map(String),
  };
};

/**
 * Serves locally installed panels to the existing registry and bundle loaders. Returning a real
 * Response keeps every validation those loaders perform -- same-origin entry points, version
 * pinning, SHA-256 integrity -- exactly as it behaves against a served deployment.
 */
export const createLocalPanelFetcher =
  (store: LocalPanelStore): typeof fetch =>
  async input => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== LOCAL_PANEL_ORIGIN) {
      throw new Error(`Refusing to serve ${url.origin} from local panel storage.`);
    }

    const contents = await store.read(url.pathname.replace(/^\/+/, ''));
    if (contents === null) return new Response(null, { status: 404, statusText: 'Not Found' });

    return new Response(contents, {
      status: 200,
      headers: {
        'content-type': url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript',
        'content-length': String(new TextEncoder().encode(contents).byteLength),
      },
    });
  };
