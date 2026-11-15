import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { checkCatalogSources } from './updates';
import { officialSource } from './official';
import { openLibraryDatabase, readLibrarySnapshot, writeLibrary } from './store';

beforeEach(async () => {
  const db = await openLibraryDatabase();
  await new Promise<void>(resolve => {
    const tx = db.transaction(['collections', 'sources', 'releases'], 'readwrite');
    for (const name of ['collections', 'sources', 'releases']) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
  });
});
afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown) => ({
  ok: true,
  headers: new Headers(),
  body: null,
  text: async () => JSON.stringify(value),
});
it('checks only metadata, detects new entries and keeps imported content untouched', async () => {
  const catalog = {
    ...officialSource.catalog,
    items: [...officialSource.catalog.items, { ...officialSource.catalog.items[0], id: 'new.robot' }],
  };
  const fetcher = vi.fn().mockResolvedValue(response(catalog));
  vi.stubGlobal('fetch', fetcher);
  expect(await checkCatalogSources(new AbortController().signal)).toEqual({
    failed: false,
    newSources: [officialSource.id],
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(officialSource.url);
  const snapshot = await readLibrarySnapshot();
  expect(snapshot.sources[0].catalog).toEqual(catalog);
  expect(snapshot.collections).toEqual([]);
  expect(snapshot.releases).toEqual([]);
});
it('keeps offline catalogs and checks remaining sources if one fails', async () => {
  const folder = { ...officialSource, id: 'local', type: 'folder' as const, url: undefined };
  const custom = { ...officialSource, id: 'custom', url: 'https://example.com/catalog.json' };
  await writeLibrary({ sources: [officialSource, folder, custom] });
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(response({ ...custom.catalog, title: 'Updated community' }));
  vi.stubGlobal('fetch', fetcher);
  expect((await checkCatalogSources(new AbortController().signal)).failed).toBe(true);
  const snapshot = await readLibrarySnapshot();
  expect(snapshot.sources.find(source => source.id === officialSource.id)).toEqual(officialSource);
  expect(snapshot.sources.find(source => source.id === custom.id)!.title).toBe('Updated community');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not overwrite a newer refresh or restore a removed source after a pending download', async () => {
  const custom = { ...officialSource, id: 'custom', url: 'https://example.com/catalog.json' };
  await writeLibrary({ sources: [officialSource, custom] });
  const newer = { ...officialSource, title: 'Manually refreshed', updatedAt: 42 };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) => {
      if (url === officialSource.url) await writeLibrary({ sources: [newer] });
      else await writeLibrary({ removeSources: [custom.id] });
      return response(officialSource.catalog);
    })
  );
  await checkCatalogSources(new AbortController().signal);
  expect((await readLibrarySnapshot()).sources).toEqual([newer]);
});
it('cancels a pending check without writing its response', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      controller.abort();
      return response(officialSource.catalog);
    })
  );
  await checkCatalogSources(controller.signal);
  expect((await readLibrarySnapshot()).sources).toEqual([]);
});
it('rejects invalid remote metadata and retains the last usable catalog', async () => {
  await writeLibrary({ sources: [officialSource] });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ schemaVersion: 99 })));
  expect((await checkCatalogSources(new AbortController().signal)).failed).toBe(true);
  expect((await readLibrarySnapshot()).sources).toEqual([officialSource]);
});
