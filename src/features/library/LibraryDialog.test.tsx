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
it('reviews/imports all official collections atomically, maps names and opens only explicitly', async () => {
  dialog();
  browse();
  click('Import all');
  await screen.findByText('Review import');
  expect(onUse).not.toHaveBeenCalled();
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  expand(/Topics and frames/);
  const bindings = screen.getAllByRole('textbox', { name: 'topic /joint_states' });
  fireEvent.change(bindings[0], { target: { value: '/panda/joints' } });
  click(`Import ${bundledReleases.length} collections`);
  await screen.findByText(`Imported ${bundledReleases.length} collections.`, { exact: false });
  expect((await readLibrarySnapshot()).collections).toHaveLength(bundledReleases.length);
  expect(onUse).not.toHaveBeenCalled();
  const first = screen.getAllByRole('button', { name: 'Open layout' })[0];
  fireEvent.click(first);
  expect(onUse).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'workspace', workspace: expect.objectContaining({ title: 'Panda inspection' }) })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Add Pad' })[0]);
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'pad' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Open tree' })[0]);
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'behaviorTree' }));
});
it('filters/searches, cancels reviews and surfaces invalid remappings without partial imports', async () => {
  dialog();
  browse();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Panda' } });
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'behaviorTree' } });
  click('Select multiple');
  fireEvent.click(screen.getByLabelText('Select Panda inspection'));
  click('Import selected (1)');
  await screen.findByText('Review import');
  click('Cancel import');
  expect(screen.queryByText('Review import')).toBeNull();
  click('Import selected (1)');
  await screen.findByText('Review import');
  expand(/Topics and frames/);
  fireEvent.change(screen.getByRole('textbox', { name: 'topic /joint_states' }), { target: { value: 'bad name' } });
  click('Import 1 collection');
  await screen.findByRole('alert');
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  click('Close Library');
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
  fireEvent.change(screen.getByLabelText('Library file'), {
    target: { files: [file({ libraryBackupVersion: 1, collections: [bundledReleases[0].package] })] },
  });
  await screen.findByText('Review import');
  click('Import 1 collection');
  await screen.findByText(/Imported 1 collection/);
  fireEvent.change(screen.getByLabelText('Library file'), { target: { files: [file({ schemaVersion: 99 })] } });
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
  expect(data.sources[0].title).toBe('Community');
  view.rerender(
    <LibraryDialog initialFilter="all" data={data} refresh={refresh} storageError="" onClose={onClose} onUse={onUse} />
  );
  browse(data.sources[0].id);
  click('Refresh');
  await screen.findByText('Catalog updated.');
  fetcher.mockResolvedValue({ ok: true, headers: new Headers(), body: null, text: async () => source });
  click(/^Panda inspection/);
  await screen.findByText('Preview');
  expect((await readLibrarySnapshot()).releases).toHaveLength(1);
  click('Import all');
  await screen.findByText('Review import');
  click('Import 1 collection');
  await screen.findByText(/Imported 1 collection/);
  browse(data.sources[0].id);
  expand(/Source details/);
  click('Remove source');
  await waitFor(async () => expect((await readLibrarySnapshot()).sources).toHaveLength(0));
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
    const { openLibrary } = useLibrary();
    return (
      <>
        <button onClick={() => openLibrary('pad')}>Browse</button>
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
  click('Browse');
  await screen.findByRole('dialog', { name: 'Library' });
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
});

it('clears an old preview and selection when search changes before importing', async () => {
  dialog();
  browse();
  click(/^Panda inspection/);
  await screen.findByRole('heading', { name: 'Preview' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Genesis' } });
  expect(screen.queryByRole('heading', { name: 'Preview' })).toBeNull();
  click('Import all');
  await screen.findByRole('heading', { name: 'Review import' });
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
