import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import LibraryDialog from './LibraryDialog';
import { LibraryProvider, LibraryWorkspaceGate, useLibrary } from './LibraryProvider';
import { bundledReleases, officialSource } from './official';
import { makeCollection, openLibraryDatabase, readLibrarySnapshot, writeLibrary } from './store';
import { cloneContent } from './content';
import { contentHash } from './catalog';
import type { LibraryData } from './LibraryProvider';
const empty: LibraryData = { collections: [], sources: [], releases: [] };
const refresh = vi.fn().mockResolvedValue(undefined);
const onUse = vi.fn();
const onClose = vi.fn();
const dialog = (data = empty) =>
  render(
    <LibraryDialog initialFilter="all" data={data} refresh={refresh} storageError="" onClose={onClose} onUse={onUse} />
  );
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const browse = (id?: string) => {
  click('Browse');
  if (id) fireEvent.change(screen.getByLabelText('Source'), { target: { value: id } });
};
const expand = (name: RegExp) =>
  screen.getAllByText(name, { selector: 'summary' }).forEach(element => fireEvent.click(element));
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  const db = await openLibraryDatabase();
  await new Promise<void>(resolve => {
    const tx = db.transaction(['collections', 'sources', 'releases'], 'readwrite');
    for (const name of ['collections', 'sources', 'releases']) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('finishes import with a status on the same view and opens saved items only when selected', async () => {
  const view = dialog();
  browse();
  click('Import all');
  await screen.findByText('Import contents');
  expect(onUse).not.toHaveBeenCalled();
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  const summary = within(screen.getByRole('region', { name: 'Content preview' }));
  expect(summary.getAllByText('Pad').length).toBeGreaterThan(0);
  expect(summary.getAllByText('Behavior tree').length).toBeGreaterThan(0);
  expect(summary.getAllByText(/Layout ·/).length).toBeGreaterThan(0);
  expect(summary.queryByRole('textbox')).toBeNull();
  expect(summary.queryByText(/topics and frames/i)).toBeNull();
  click(`Import ${bundledReleases.length} collections`);
  await screen.findByText('Imported successfully.');
  expect(screen.getByLabelText('Source')).toHaveValue(officialSource.id);
  expect(screen.queryByRole('heading', { name: 'Preview' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Open layout|Open tree|Add Pad)$/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Browse' })).toHaveAttribute('aria-pressed', 'true');
  expect((await readLibrarySnapshot()).collections).toHaveLength(bundledReleases.length);
  expect(onUse).not.toHaveBeenCalled();
  view.rerender(
    <LibraryDialog
      initialFilter="all"
      data={await readLibrarySnapshot()}
      refresh={refresh}
      storageError=""
      onClose={onClose}
      onUse={onUse}
    />
  );
  click('Saved');
  click(/^Panda inspection/);
  const first = screen.getByRole('button', { name: 'Open layout' });
  fireEvent.click(first);
  expect(onUse).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'workspace', workspace: expect.objectContaining({ title: 'Panda inspection' }) })
  );
  fireEvent.click(screen.getAllByRole('button', { name: /^Joint readout/ })[0]);
  click('Add Pad');
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'pad' }));
  fireEvent.click(screen.getAllByRole('button', { name: /^Readiness example/ })[0]);
  click('Open tree');
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'behaviorTree' }));
});
it('filters/searches and cancels import without saving anything', async () => {
  dialog();
  browse();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Panda' } });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'behaviorTree' } });
  click('Select multiple');
  fireEvent.click(screen.getByLabelText('Select Panda inspection'));
  click('Import selected (1)');
  await screen.findByText('Import contents');
  click('Cancel import');
  expect(screen.queryByText('Import contents')).toBeNull();
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  click('Close Catalog');
  expect(onClose).toHaveBeenCalled();
});
it('refreshes Official from its current endpoint after an app update moves the catalog', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers(),
    body: null,
    text: async () => JSON.stringify(officialSource.catalog),
  });
  vi.stubGlobal('fetch', fetcher);
  dialog({
    ...empty,
    sources: [
      {
        ...officialSource,
        url: 'https://raw.githubusercontent.com/tessel-la/robo-boy/dev/library/catalog.json',
        catalog: { ...officialSource.catalog, items: [] },
      },
    ],
  });
  browse();
  expect(screen.getByRole('button', { name: /^Genesis control/ })).toBeVisible();
  click('Refresh');
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(fetcher.mock.calls[0][0]).toBe(officialSource.url);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect((await readLibrarySnapshot()).sources[0].url).toBe(officialSource.url);
});
it('renames with revision protection, archives and restores while preserving references', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package));
  await writeLibrary({ collections: [item] });
  const view = dialog({ ...empty, collections: [item] });
  click(/^Panda inspection/);
  expand(/Details & collection/);
  fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'My Panda' } });
  click('Rename');
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect((await readLibrarySnapshot()).collections[0].title).toBe('My Panda');
  click('Archive collection');
  click('Confirm archive');
  await screen.findByText('Collection archived. Open layouts still work.');
  const stored = (await readLibrarySnapshot()).collections[0];
  expect(stored.archivedAt).toBeTruthy();
  click('Restore collection');
  await waitFor(async () => expect((await readLibrarySnapshot()).collections[0].archivedAt).toBeUndefined());
  view.unmount();
});
it('imports files/backups with review and rejects invalid formats', async () => {
  dialog();
  const file = (value: unknown) => new File([JSON.stringify(value)], 'library.json');
  fireEvent.change(screen.getByLabelText('Catalog file'), {
    target: { files: [file({ libraryBackupVersion: 1, collections: [bundledReleases[0].package] })] },
  });
  await screen.findByText('Import contents');
  click('Import 1 collection');
  await screen.findByText('Imported successfully.');
  fireEvent.change(screen.getByLabelText('Catalog file'), { target: { files: [file({ schemaVersion: 99 })] } });
  await screen.findByRole('alert');
  expect((await readLibrarySnapshot()).collections).toHaveLength(1);
});
it('adds and refreshes a custom catalog, caches verified content and preserves imported copies when source is removed', async () => {
  const source = JSON.stringify({ ...cloneContent(bundledReleases[0].package), id: 'community.panda' });
  const catalog = {
    ...officialSource.catalog,
    title: 'Community',
    items: [{ ...officialSource.catalog.items[0], id: 'community.panda', sha256: contentHash(source) }],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue({ ok: true, headers: new Headers(), body: null, text: async () => JSON.stringify(catalog) });
  vi.stubGlobal('fetch', fetcher);
  const view = dialog();
  expand(/^Import$/);
  click('Online catalog…');
  fireEvent.change(screen.getByLabelText('Catalog URL'), { target: { value: 'https://example.com/catalog.json' } });
  click('Add source');
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const data = await readLibrarySnapshot();
  const community = data.sources.find(source => source.title === 'Community')!;
  expect(community).toBeTruthy();
  view.rerender(
    <LibraryDialog initialFilter="all" data={data} refresh={refresh} storageError="" onClose={onClose} onUse={onUse} />
  );
  browse(community.id);
  click('Refresh');
  await screen.findByText('Catalog updated.');
  fetcher.mockResolvedValue({ ok: true, headers: new Headers(), body: null, text: async () => source });
  click(/^Panda inspection/);
  await screen.findByText('Preview');
  expect((await readLibrarySnapshot()).releases).toHaveLength(1);
  click('Import all');
  await screen.findByText('Import contents');
  click('Import 1 collection');
  await screen.findByText('Imported successfully.');
  browse(community.id);
  expand(/Source details/);
  click('Remove source');
  await waitFor(async () =>
    expect((await readLibrarySnapshot()).sources.some(source => source.id === community.id)).toBe(false)
  );
  expect((await readLibrarySnapshot()).collections).toHaveLength(1);
});
it('shows a usable storage error/retry and warns without mutating broken saved items', () => {
  localStorage.setItem('robo-boy-desktop-workspace-saved-layouts-v1', 'broken');
  render(
    <LibraryDialog
      initialFilter="all"
      data={empty}
      refresh={refresh}
      storageError="Storage failed"
      onClose={onClose}
      onUse={onUse}
    />
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Storage failed');
  click('Retry storage');
  expect(refresh).toHaveBeenCalled();
  expect(localStorage.getItem('robo-boy-desktop-workspace-saved-layouts-v1')).toBe('broken');
});
it('hydrates templates before workspace mounting and synchronizes same-window updates', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package));
  await writeLibrary({ collections: [item] });
  function Launcher() {
    const { openLibrary, workspaces } = useLibrary();
    return (
      <>
        <button onClick={() => openLibrary('pad')}>Browse</button>
        <output aria-label="Available layouts">{workspaces.length}</output>
        <LibraryWorkspaceGate>
          <p>Workspace ready</p>
        </LibraryWorkspaceGate>
      </>
    );
  }
  render(
    <LibraryProvider onUse={onUse}>
      <Launcher />
    </LibraryProvider>
  );
  await screen.findByText('Workspace ready');
  expect(screen.getByLabelText('Available layouts')).toHaveTextContent('1');
  click('Browse');
  await screen.findByRole('dialog', { name: 'Catalog' });
  expect(screen.getByLabelText('Type')).toHaveValue('pad');
  click(/^Joint readout/);
  click('Add Pad');
  expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pad' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await writeLibrary({
    collections: [makeCollection({ ...cloneContent(bundledReleases[0].package), title: 'Second robot' })],
  });
  click('Browse');
  await screen.findByRole('button', { name: /Second robot/ });
  await waitFor(() => expect(screen.getByLabelText('Available layouts')).toHaveTextContent('2'));
});

it('clears an old preview and selection when search changes before importing', async () => {
  dialog();
  browse();
  click(/^Panda inspection/);
  await screen.findByRole('heading', { name: 'Preview' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Genesis' } });
  expect(screen.queryByRole('heading', { name: 'Preview' })).toBeNull();
  click('Import all');
  await screen.findByRole('heading', { name: 'Import contents' });
  expect(within(screen.getByRole('region', { name: 'Content preview' })).getByText('Move Genesis X Y')).toBeVisible();
  expect(screen.queryByText('Readiness example')).toBeNull();
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
});

it('exports each collection once when Saved lists its individual documents', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package));
  let exported!: Blob;
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL(blob: Blob) {
        exported = blob;
        return 'blob:test';
      }
      static revokeObjectURL() {}
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  dialog({ ...empty, collections: [item] });
  expect(screen.getByRole('button', { name: /^Joint readout/ })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Readiness example/ })).toBeVisible();
  expand(/Saved options/);
  click('Export all');
  const text = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(exported);
  });
  expect(JSON.parse(text).collections).toEqual([item.package]);
});

it('reports a failed import without switching views or activating content, then allows retry', async () => {
  dialog();
  browse();
  click('Import all');
  await screen.findByText('Import contents');
  const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
    throw new Error('Storage is full.');
  });
  click(`Import ${bundledReleases.length} collections`);
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage is full.');
  expect(screen.queryByText('Imported successfully.')).toBeNull();
  expect(screen.getByLabelText('Source')).toHaveValue(officialSource.id);
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  expect(onUse).not.toHaveBeenCalled();
  add.mockRestore();
  click(`Import ${bundledReleases.length} collections`);
  await screen.findByText('Imported successfully.');
  expect((await readLibrarySnapshot()).collections).toHaveLength(bundledReleases.length);
  expect(screen.queryByRole('button', { name: 'Add Pad' })).toBeNull();
});

it('reports repeated file imports without adding duplicate collections', async () => {
  dialog();
  const file = new File([JSON.stringify(bundledReleases[0].package)], 'panda.json');
  for (const status of ['Imported successfully.', 'Already imported.']) {
    fireEvent.change(screen.getByLabelText('Catalog file'), { target: { files: [file] } });
    await screen.findByText('Import contents');
    click('Import 1 collection');
    await screen.findByText(status);
  }
  expect((await readLibrarySnapshot()).collections).toHaveLength(1);
  expect(onUse).not.toHaveBeenCalled();
});
it.each(['pad', 'behaviorTree', 'workspace'])(
  'removes an imported %s with confirmation and preserves its package',
  async kind => {
    const item = makeCollection(cloneContent(bundledReleases[0].package));
    await writeLibrary({ collections: [item] });
    const view = dialog({ ...empty, collections: [item] });
    const doc = item.package.documents.find(doc => doc.kind === kind)!;
    const name = (doc.data as any).name ?? (doc.data as any).title;
    click(`Remove ${name}`);
    click('Cancel');
    expect((await readLibrarySnapshot()).collections[0].removedDocumentIds).toBeUndefined();
    click(`Remove ${name}`);
    click(`Confirm remove ${name}`);
    await screen.findByText('Removed.');
    const data = await readLibrarySnapshot();
    expect(data.collections[0].removedDocumentIds).toEqual([doc.id]);
    expect(data.collections[0].package).toEqual(item.package);
    view.rerender(
      <LibraryDialog
        initialFilter="all"
        data={data}
        refresh={refresh}
        storageError=""
        onClose={onClose}
        onUse={onUse}
      />
    );
    expect(screen.queryByRole('button', { name: `Remove ${name}` })).toBeNull();
    expect(onUse).not.toHaveBeenCalled();
  }
);
it('shows an available update after checking on open and requires review/import to apply it', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package), {
    sourceId: officialSource.id,
    itemId: officialSource.catalog.items[0].id,
    version: '1.0.0',
    sha256: bundledReleases[0].sha256,
  });
  await writeLibrary({ collections: [item] });
  const latest = {
    ...officialSource,
    updatedAt: 1,
    catalog: {
      ...officialSource.catalog,
      items: [{ ...officialSource.catalog.items[0], version: '1.1.0', sha256: 'c'.repeat(64) }],
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: null,
      text: async () => JSON.stringify(latest.catalog),
    })
  );
  const view = dialog({ ...empty, collections: [item] });
  await waitFor(async () => expect((await readLibrarySnapshot()).sources).toHaveLength(1));
  view.rerender(
    <LibraryDialog
      initialFilter="all"
      data={await readLibrarySnapshot()}
      refresh={refresh}
      storageError=""
      onClose={onClose}
      onUse={onUse}
    />
  );
  expect(screen.getByText('Catalog updates available.')).toBeVisible();
  click('Review updates');
  expect(screen.getByLabelText('Source')).toHaveValue(officialSource.id);
  expect(screen.getByRole('button', { name: 'Import selected (1)' })).toBeVisible();
  expect((await readLibrarySnapshot()).collections).toEqual([item]);
  expect(onUse).not.toHaveBeenCalled();
});

it('rejects malformed removal metadata without altering stored packages', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package));
  (item as any).removedDocumentIds = 'pad/joints';
  await writeLibrary({ collections: [item] });
  function Launcher() {
    const { openLibrary } = useLibrary();
    return <button onClick={() => openLibrary()}>Open Catalog</button>;
  }
  render(
    <LibraryProvider onUse={onUse}>
      <Launcher />
    </LibraryProvider>
  );
  click('Open Catalog');
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid removed catalog items');
  expect((await readLibrarySnapshot()).collections[0].package).toEqual(item.package);
});
