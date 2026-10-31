import { readCatalog, contentHash } from './catalog';
import { readLibraryPackage } from './content';
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  LIBRARY_CHANGED,
  readLibrarySnapshot,
  type LibraryCollection,
  type LibrarySource,
  type CachedRelease,
} from './store';
import { validateLibraryPackage } from './content';
import { getLibraryWorkspaces, setLibrarySnapshot, type LibraryOpenRequest } from './runtime';
import type { ContentKind } from './packages';
const LibraryDialog = lazy(() => import('./LibraryDialog'));
export type LibraryFilter = ContentKind | 'all';
interface LibraryContextValue {
  openLibrary: (filter?: LibraryFilter) => void;
  ready: boolean;
  workspaces: ReturnType<typeof getLibraryWorkspaces>;
}
const Context = createContext<LibraryContextValue>({ openLibrary: () => {}, ready: true, workspaces: [] });
export const useLibrary = () => useContext(Context);
export interface LibraryData {
  collections: LibraryCollection[];
  sources: LibrarySource[];
  releases: CachedRelease[];
}
export function LibraryProvider({
  children,
  onUse,
}: {
  children: React.ReactNode;
  onUse: (request: LibraryOpenRequest) => void;
}) {
  const [filter, setFilter] = useState<LibraryFilter | null>(null);
  const [data, setData] = useState<LibraryData>({ collections: [], sources: [], releases: [] });
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const snapshot = await readLibrarySnapshot();
      const validated = snapshot.collections.map(item => ({ ...item, package: validateLibraryPackage(item.package) }));
      const sources = snapshot.sources.map(item => ({ ...item, catalog: readCatalog(JSON.stringify(item.catalog)) }));
      // Cache is disposable; a damaged entry must not lock the collection store or prevent refresh.
      const releases = snapshot.releases.flatMap(item => {
        try {
          return contentHash(item.source) === item.sha256
            ? [{ ...item, package: readLibraryPackage(item.source) }]
            : [];
        } catch {
          return [];
        }
      });
      if (generation.current !== request) return;
      setData({ collections: validated, sources, releases });
      setLibrarySnapshot(validated);
      setError('');
    } catch (error) {
      if (generation.current === request) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation.current === request) setReady(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => void refresh();
    window.addEventListener(LIBRARY_CHANGED, update);
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(LIBRARY_CHANGED) : undefined;
    if (channel) channel.onmessage = update;
    return () => {
      generation.current++;
      window.removeEventListener(LIBRARY_CHANGED, update);
      channel?.close();
    };
  }, [refresh]);
  return (
    <Context.Provider
      value={{ ready, workspaces: getLibraryWorkspaces(), openLibrary: (next = 'all') => setFilter(next) }}
    >
      {children}
      {filter !== null && (
        <Suspense fallback={<div role="status">Opening Catalog…</div>}>
          <LibraryDialog
            initialFilter={filter}
            data={data}
            storageError={error}
            refresh={refresh}
            onClose={() => setFilter(null)}
            onUse={request => {
              onUse(request);
              setFilter(null);
            }}
          />
        </Suspense>
      )}
    </Context.Provider>
  );
}
export function LibraryWorkspaceGate({ children }: { children: React.ReactNode }) {
  return useLibrary().ready ? <>{children}</> : <div role="status">Loading saved catalog content…</div>;
}
