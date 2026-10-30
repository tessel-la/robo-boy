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
  click(/Official/);
  click('Import all');
  await screen.findByText('Review import');
  expect(onUse).not.toHaveBeenCalled();
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  const bindings = screen.getAllByRole('textbox', { name: 'topic /joint_states' });
  fireEvent.change(bindings[0], { target: { value: '/panda/joints' } });
  click('Import 2 collections');
  await screen.findByText(/Imported 2 collections/);
  expect((await readLibrarySnapshot()).collections).toHaveLength(2);
  expect(onUse).not.toHaveBeenCalled();
  const first = screen.getAllByRole('button', { name: 'Open workspace' })[0];
  fireEvent.click(first);
  expect(onUse).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'workspace', workspace: expect.objectContaining({ title: 'Panda inspection' }) })
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Add Pad' })[0]);
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'pad' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Open BT' })[0]);
  expect(onUse).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'behaviorTree' }));
});
it('filters/searches, cancels reviews and surfaces invalid remappings without partial imports', async () => {
  dialog();
  click(/Official/);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Panda' } });
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'behaviorTree' } });
  fireEvent.click(screen.getByLabelText('Select Panda inspection'));
  click('Import selected');
  await screen.findByText('Review import');
  click('Cancel import');
  expect(screen.queryByText('Review import')).toBeNull();
  click('Import selected');
  await screen.findByText('Review import');
  fireEvent.change(screen.getByRole('textbox', { name: 'topic /joint_states' }), { target: { value: 'bad name' } });
  click('Import 1 collection');
  await screen.findByRole('alert');
  expect((await readLibrarySnapshot()).collections).toHaveLength(0);
  click('Close Library');
  expect(onClose).toHaveBeenCalled();
});
it('renames with revision protection, archives and restores while preserving references', async () => {
  const item = makeCollection(cloneContent(bundledReleases[0].package));
  await writeLibrary({ collections: [item] });
  const view = dialog({ ...empty, collections: [item] });
  click(/Panda inspection/);
  fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'My Panda' } });
  click('Rename');
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect((await readLibrarySnapshot()).collections[0].title).toBe('My Panda');
  click('Archive collection');
  click('Confirm archive');
  await screen.findByText('Collection archived. Workspace references remain available.');
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
  click('Add catalog');
  fireEvent.change(screen.getByLabelText('Catalog URL'), { target: { value: 'https://example.com/catalog.json' } });
  click('Add source');
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  const data = await readLibrarySnapshot();
  expect(data.sources[0].title).toBe('Community');
  view.rerender(
    <LibraryDialog initialFilter="all" data={data} refresh={refresh} storageError="" onClose={onClose} onUse={onUse} />
  );
  click(/Community/);
  click('Refresh');
  await screen.findByText('Catalog refreshed. Existing copies are unchanged.');
  fetcher.mockResolvedValue({ ok: true, headers: new Headers(), body: null, text: async () => source });
  click(/Panda inspection/);
  await screen.findByText('Preview');
  expect((await readLibrarySnapshot()).releases).toHaveLength(1);
  click('Import all');
  await screen.findByText('Review import');
  click('Import 1 collection');
  await screen.findByText(/Imported 1 collection/);
  click(/Community/);
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
  expect(screen.getByLabelText('Kind')).toHaveValue('pad');
  click(/Panda inspection/);
  click('Add Pad');
  expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pad' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await writeLibrary({
    collections: [makeCollection({ ...cloneContent(bundledReleases[0].package), title: 'Second robot' })],
  });
  click('Browse');
  await screen.findByRole('button', { name: /Second robot/ });
});
