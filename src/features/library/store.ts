import { isEqual } from 'lodash-es';
import { gt } from 'semver';
import type { LibraryPackage } from './content';
import type { ContentKind } from './packages';
import { createUuid } from '../../utils/uuid';
export interface CatalogItem {
  id: string;
  title: string;
  description?: string;
  kind: ContentKind | 'collection';
  kinds?: ContentKind[];
  version: string;
  url: string;
  sha256: string;
  tags?: string[];
}
export interface Catalog {
  schemaVersion: 1;
  title: string;
  items: CatalogItem[];
}
export interface LibrarySource {
  id: string;
  title: string;
  type: 'https' | 'folder';
  url?: string;
  updatedAt: number;
  catalog: Catalog;
}
export interface LibraryOrigin {
  sourceId: string;
  itemId: string;
  version: string;
  sha256: string;
}
export interface LibraryCollection {
  id: string;
  title: string;
  package: LibraryPackage;
  origin?: LibraryOrigin;
  createdAt: number;
  revision?: number;
  archivedAt?: number;
  /** Hide a document from selection while preserving package-local dependencies. */
  removedDocumentIds?: string[];
}
export interface CachedRelease {
  sha256: string;
  source: string;
  package: LibraryPackage;
}
const NAME = 'robo-boy-content-library';
export const LIBRARY_CHANGED = 'robo-boy-library-changed';
let connection: Promise<IDBDatabase> | undefined;
export function openLibraryDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Library storage is unavailable in this browser.'));
  return (connection ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Library storage is unavailable in this browser.'));
      return;
    }
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['collections', 'sources', 'releases'])
        request.result.createObjectStore(name, { keyPath: name === 'releases' ? 'sha256' : 'id' });
    };
    request.onerror = () => {
      connection = undefined;
      reject(request.error ?? new Error('Unable to open Library storage.'));
    };
    request.onblocked = () => {
      connection = undefined;
      reject(new Error('Close other Robo-Boy windows to upgrade Library storage.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
  }));
}
/** Read related records from one database snapshot, including across windows. */
export async function readLibrarySnapshot(): Promise<{
  collections: LibraryCollection[];
  sources: LibrarySource[];
  releases: CachedRelease[];
}> {
  const db = await openLibraryDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['collections', 'sources', 'releases'], 'readonly');
    const collections = tx.objectStore('collections').getAll();
    const sources = tx.objectStore('sources').getAll();
    const releases = tx.objectStore('releases').getAll();
    tx.oncomplete = () =>
      resolve({ collections: collections.result, sources: sources.result, releases: releases.result });
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Unable to read Library.'));
  });
}
/** Resolve only after transaction completion: collections and provenance commit together or not at all. */
export async function writeLibrary(
  changes: {
    collections?: LibraryCollection[];
    importCollections?: LibraryCollection[];
    refreshSources?: Array<{ source: LibrarySource; previous?: LibrarySource }>;
    sources?: LibrarySource[];
    releases?: CachedRelease[];
    updateCollections?: Array<{ collection: LibraryCollection; expectedRevision: number }>;
    removeSources?: string[];
  },
  signal?: AbortSignal
): Promise<{ imported: number; skipped: number }> {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  const db = await openLibraryDatabase();
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
  const result = { imported: 0, skipped: 0 };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['collections', 'sources', 'releases'], 'readwrite');
    let failure: unknown;
    const abort = () => {
      try {
        tx.abort();
      } catch {
        /* already completed */
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    const done = () => signal?.removeEventListener('abort', abort);
    tx.oncomplete = () => {
      done();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      done();
      reject(
        failure ??
          tx.error ??
          new Error(
            'Library write was cancelled. Previous contents were preserved. Reload if another window changed this collection.'
          )
      );
    };
    try {
      for (const item of changes.collections ?? []) tx.objectStore('collections').add(item);
      if (changes.importCollections?.length) {
        const request = tx.objectStore('collections').getAll();
        request.onsuccess = () => {
          try {
            const existing = request.result as LibraryCollection[];
            for (const incoming of changes.importCollections!) {
              const matches = existing.filter(item => isEqual(item.package, incoming.package));
              const same = matches.find(item => !item.archivedAt && !item.removedDocumentIds?.length) ?? matches[0];
              if (same) {
                if (same.archivedAt || same.removedDocumentIds?.length || (!same.origin && incoming.origin)) {
                  const restored = {
                    ...same,
                    archivedAt: undefined,
                    removedDocumentIds: undefined,
                    origin: same.origin ?? incoming.origin,
                    revision: (same.revision ?? 0) + 1,
                  };
                  tx.objectStore('collections').put(restored);
                  Object.assign(same, restored);
                  result.imported++;
                } else result.skipped++;
                continue;
              }
              // Explicitly importing a new release replaces it in pickers; old references still resolve.
              for (const prior of existing) {
                if (
                  incoming.origin &&
                  prior.origin?.sourceId === incoming.origin.sourceId &&
                  prior.origin.itemId === incoming.origin.itemId &&
                  (gt(incoming.package.version, prior.package.version) ||
                    incoming.package.version === prior.package.version)
                ) {
                  const archived = { ...prior, archivedAt: Date.now(), revision: (prior.revision ?? 0) + 1 };
                  tx.objectStore('collections').put(archived);
                  Object.assign(prior, archived);
                }
              }
              tx.objectStore('collections').add(incoming);
              existing.push(incoming);
              result.imported++;
            }
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      }
      for (const { source, previous } of changes.refreshSources ?? []) {
        const request = tx.objectStore('sources').get(source.id);
        request.onsuccess = () => {
          try {
            const current = request.result as LibrarySource | undefined;
            if (previous ? isEqual(current, previous) : !current) tx.objectStore('sources').put(source);
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      }
      for (const name of ['sources', 'releases'] as const)
        for (const item of changes[name] ?? []) tx.objectStore(name).put(item);
      for (const { collection, expectedRevision } of changes.updateCollections ?? []) {
        const request = tx.objectStore('collections').get(collection.id);
        request.onsuccess = () => {
          const current = request.result as LibraryCollection | undefined;
          if (!current || (current.revision ?? 0) !== expectedRevision) {
            tx.abort();
            return;
          }
          tx.objectStore('collections').put({ ...collection, revision: expectedRevision + 1 });
        };
      }
      for (const id of changes.removeSources ?? []) tx.objectStore('sources').delete(id);
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
  window.dispatchEvent(new Event(LIBRARY_CHANGED));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(LIBRARY_CHANGED);
    channel.postMessage('changed');
    channel.close();
  }
  return result;
}
export function makeCollection(pack: LibraryPackage, origin?: LibraryOrigin): LibraryCollection {
  return { id: createUuid(), title: pack.title, package: pack, origin, createdAt: Date.now() };
}
