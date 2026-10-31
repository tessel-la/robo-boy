import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contentHash,
  catalogUrl,
  checkedRelease,
  resolveRelease,
  readCatalog,
  readLibraryFolder,
  fetchContent,
} from './catalog';
import { bindPackage, cloneContent, packageBindings, readLibraryPackage, validateLibraryPackage } from './content';
import { bundledReleases, officialSource } from './official';
import { makeCollection, openLibraryDatabase, readLibrarySnapshot, writeLibrary } from './store';
import {
  getLibraryPad,
  getLibraryPads,
  getLibraryTree,
  libraryDocumentId,
  openLibraryDocument,
  setLibrarySnapshot,
} from './runtime';
import { packageSavedWorkspace, readSavedContent } from './savedContent';
import type { SavedWorkspaceLayout } from '../workspace/documents';

const starter = () => cloneContent(bundledReleases[0].package);
const folderFile = (path: string, value: unknown) => {
  const file = new File([typeof value === 'string' ? value : JSON.stringify(value)], path.split('/').slice(-1)[0]);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
};
beforeEach(async () => {
  localStorage.clear();
  setLibrarySnapshot([]);
  vi.restoreAllMocks();
  const db = await openLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['collections', 'sources', 'releases'], 'readwrite');
    for (const name of ['collections', 'sources', 'releases']) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
});
describe('Library packages and ownership', () => {
  it('validates official collections, all document bodies, compatibility and dependency closure', () => {
    expect(bundledReleases).toHaveLength(officialSource.catalog.items.length);
    for (const item of bundledReleases) expect(validateLibraryPackage(item.package).documents).toHaveLength(3);
    const pack = starter();
    pack.documents = pack.documents.filter(doc => doc.kind !== 'pad');
    expect(() => validateLibraryPackage(pack)).toThrow('Missing packaged Pad');
    const broken = starter();
    (broken.documents[0].data as any).components[0].config.fieldPath = 'constructor.x';
    expect(() => validateLibraryPackage(broken)).toThrow('prototype');
    expect(() => validateLibraryPackage({ ...starter(), compatibility: { roboboy: '<0.1.0' } })).toThrow('requires');
    expect(() => validateLibraryPackage({ ...starter(), tags: [3] })).toThrow('tags');
  });
  it('maps only declared ROS names and frames, preserving payloads and labels', () => {
    const pack = starter();
    const tree = pack.documents.find(doc => doc.kind === 'behaviorTree')!.data as any;
    tree.nodes = [
      {
        id: 'call',
        type: 'service',
        position: { x: 0, y: 0 },
        data: {
          label: '/joint_states',
          serviceName: '/reset',
          serviceType: 'std_srvs/srv/Trigger',
          request: { topic: '/joint_states' },
          status: 'running',
        },
      },
    ];
    const bindings = packageBindings(pack);
    expect(bindings).toEqual(
      expect.arrayContaining([
        { kind: 'topic', from: '/joint_states', to: '/joint_states' },
        { kind: 'service', from: '/reset', to: '/reset' },
        { kind: 'frame', from: 'panda_link0', to: 'panda_link0' },
      ])
    );
    const result = bindPackage(
      pack,
      bindings.map(item => ({ ...item, to: item.kind === 'frame' ? 'map' : `/robot${item.from}` }))
    );
    const pad = result.documents[0].data as any;
    expect(pad.components[0].action.topic).toBe('/robot/joint_states');
    const node = (result.documents[1].data as any).nodes[0];
    expect(node.data.serviceName).toBe('/robot/reset');
    expect(node.data.request.topic).toBe('/joint_states');
    expect(node.data.label).toBe('/joint_states');
    expect(node.data.status).toBeUndefined();
    expect((pack.documents[0].data as any).components[0].action.topic).toBe('/joint_states');
    expect(() => bindPackage(pack, [{ kind: 'topic', from: '/joint_states', to: 'bad name' }])).toThrow('Invalid');
  });
  it('reads old bundles including embedded BTs without retaining live execution or approvals', () => {
    const pack = starter();
    const layout = cloneContent(pack.documents[2].data) as any;
    layout.panels[1].layoutId = 'joints';
    layout.panels[2].treeId = undefined;
    layout.panels[2].initialTree = pack.documents[1].data;
    layout.panels[0].approvedRosTopics = [{ name: '/secret', messageType: 'std_msgs/msg/String' }];
    const converted = readLibraryPackage(
      JSON.stringify({ version: 2, layouts: [layout], gamepads: [pack.documents[0].data] })
    );
    expect(converted.documents.map(doc => doc.kind)).toEqual(['pad', 'behaviorTree', 'workspace']);
    const panels = (converted.documents[2].data as any).panels;
    expect(panels[0].approvedRosTopics).toBeUndefined();
    expect(panels[2].treeId).toBe('bt/0');
  });
  it('opens fresh workspaces preserving package references, geometry and isolated templates', () => {
    const item = makeCollection(starter());
    setLibrarySnapshot([item]);
    const doc = item.package.documents[2];
    const first = openLibraryDocument(item, doc);
    const second = openLibraryDocument(item, doc);
    expect(first.workspace!.id).not.toBe(second.workspace!.id);
    expect(first.workspace!.panels[0].id).not.toBe(second.workspace!.panels[0].id);
    expect(first.workspace!.panels[1].layoutId).toBe(libraryDocumentId(item.id, 'pad/joints'));
    expect(first.workspace!.tileOrder).toEqual(first.workspace!.panels.map(panel => panel.id));
    expect(first.visualizations![0].state.fixedFrame).toBe('panda_link0');
    const pads = getLibraryPads();
    pads[0].layout.name = 'Changed';
    expect(getLibraryPads()[0].layout.name).toBe('Joint readout');
    const treeId = first.workspace!.panels[2].treeId!;
    expect(getLibraryTree(treeId)?.name).toBe('Readiness example');
    expect(getLibraryTree('missing')).toBeNull();
    expect(openLibraryDocument(item, item.package.documents[0]).padId).toBe(pads[0].id);
    expect(openLibraryDocument(item, item.package.documents[1]).tree?.id).toBe('readiness');
    const exported = packageSavedWorkspace(first.workspace!);
    expect(exported.documents).toHaveLength(3);
    expect(validateLibraryPackage(exported)).toBeTruthy();
  });
  it('aggregates authored content without migrating or modifying the source stores', () => {
    const pack = starter();
    const layout = pack.documents[2].data as SavedWorkspaceLayout;
    localStorage.setItem(
      'robo-boy-desktop-workspace-saved-layouts-v1',
      JSON.stringify([{ ...layout, panels: [], tileOrder: [], layout: { version: 2, root: null } }])
    );
    const before = localStorage.getItem('robo-boy-desktop-workspace-saved-layouts-v1');
    expect(readSavedContent().items).toHaveLength(1);
    expect(localStorage.getItem('robo-boy-desktop-workspace-saved-layouts-v1')).toBe(before);
    localStorage.setItem('robo-boy-desktop-workspace-saved-layouts-v1', 'broken');
    expect(readSavedContent().warnings).toHaveLength(1);
  });
});
describe('catalog and folder boundaries', () => {
  it('normalizes GitHub links, forbids credentials/http and checks exact raw hashes and identity', () => {
    expect(catalogUrl('https://github.com/org/repo/blob/main/catalog.json')).toBe(
      'https://raw.githubusercontent.com/org/repo/main/catalog.json'
    );
    for (const url of ['http://example.com/catalog.json', 'https://token@example.com/catalog.json', 'file:///tmp/a'])
      expect(() => catalogUrl(url)).toThrow();
    const item = officialSource.catalog.items[0];
    expect(checkedRelease(bundledReleases[0].source, item).package.id).toBe(item.id);
    expect(() => checkedRelease(bundledReleases[0].source + ' ', item)).toThrow('SHA-256');
    expect(() => checkedRelease(bundledReleases[0].source, { ...item, id: 'other' })).toThrow('identity');
    expect(() => readCatalog(JSON.stringify({ ...officialSource.catalog, items: [item, item] }))).toThrow('unique');
    expect(() => readCatalog(JSON.stringify({ ...officialSource.catalog, schemaVersion: 2 }))).toThrow('version');
    expect(() =>
      readCatalog(JSON.stringify({ ...officialSource.catalog, items: [{ ...item, sha256: 'no' }] }))
    ).toThrow('SHA-256');
  });
  it('imports a whole manifest folder and rejects missing, escaped and tampered files', async () => {
    const item = officialSource.catalog.items[0];
    const catalog = { schemaVersion: 1, title: 'Panda', items: [{ ...item, url: 'inspection.json' }] };
    const files = [
      folderFile('panda/catalog.json', catalog),
      folderFile('panda/inspection.json', bundledReleases[0].source),
    ];
    const result = await readLibraryFolder(files);
    expect(result.releases).toHaveLength(1);
    expect(result.source.title).toBe('Panda');
    await expect(readLibraryFolder(files.slice(0, 1))).rejects.toThrow('Missing');
    await expect(
      readLibraryFolder([
        folderFile('panda/catalog.json', { ...catalog, items: [{ ...catalog.items[0], url: '../inspection.json' }] }),
        files[1],
      ])
    ).rejects.toThrow('inside');
    await expect(
      readLibraryFolder([files[0], folderFile('panda/inspection.json', bundledReleases[0].source + ' ')])
    ).rejects.toThrow('SHA-256');
    const signal = new AbortController();
    signal.abort();
    await expect(readLibraryFolder(files, signal.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('resolves separate legacy workspace/Pad files deterministically and ignores unrelated JSON', async () => {
    const pack = starter();
    const layout = cloneContent(pack.documents[2].data) as any;
    layout.panels = layout.panels.slice(0, 2);
    layout.panels[1].layoutId = 'joints';
    delete layout.layout;
    delete layout.tileOrder;
    const files = [
      folderFile('panda/z-workspace.json', { version: 2, layouts: [layout] }),
      folderFile('panda/a-pads.json', { version: '1.0.0', layouts: [pack.documents[0].data] }),
      folderFile('panda/package.json', { name: 'robot' }),
    ];
    const result = await readLibraryFolder(files);
    const reversed = await readLibraryFolder([...files].reverse());
    expect(result.source.catalog).toEqual(reversed.source.catalog);
    expect(result.skipped).toBe(1);
    expect(result.releases[1].package.documents).toHaveLength(2);
    await expect(readLibraryFolder([files[0], files[2]])).rejects.toThrow('Missing or ambiguous');
    await expect(
      readLibraryFolder([...files, folderFile('panda/b-pads.json', { layouts: [pack.documents[0].data] })])
    ).rejects.toThrow('ambiguous');
  });
  it('fetches without credentials/redirects and enforces streamed and advertised sizes', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), body: null, text: async () => '{}' });
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchContent('https://example.com/catalog.json')).toBe('{}');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
    fetcher.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchContent('https://example.com/a')).rejects.toThrow('404');
    fetcher.mockResolvedValue({ ok: true, headers: new Headers({ 'content-length': '6000000' }) });
    await expect(fetchContent('https://example.com/a')).rejects.toThrow('5 MiB');
    const cancel = vi.fn().mockResolvedValue(undefined);
    fetcher.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      body: {
        getReader: () => ({ read: async () => ({ value: new Uint8Array(6 * 1024 * 1024), done: false }), cancel }),
      },
    });
    await expect(fetchContent('https://example.com/a')).rejects.toThrow('5 MiB');
    expect(cancel).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
it('revalidates cached release identity and maps camera calibration, optical and displayed frames', async () => {
  const item = officialSource.catalog.items[0];
  await expect(resolveRelease(officialSource, { ...item, id: 'spoofed' }, bundledReleases[0])).rejects.toThrow(
    'identity'
  );
  const pack = starter();
  const scene = (pack.documents[2].data as any).panels[0].visualization;
  scene.displayedTfFrames = ['panda_link0'];
  scene.visualizations = [
    {
      id: 'camera',
      type: 'cameraimage',
      topic: '/image',
      options: {
        cameraInfoTopic: '/info',
        opticalFrame: 'optical',
        capture: { kind: 'service', name: '/capture', outputTopic: '/result' },
      },
    },
  ];
  const bindings = packageBindings(pack);
  expect(bindings).toEqual(
    expect.arrayContaining([
      { kind: 'topic', from: '/info', to: '/info' },
      { kind: 'frame', from: 'optical', to: 'optical' },
      { kind: 'service', from: '/capture', to: '/capture' },
    ])
  );
  const mapped = bindPackage(
    pack,
    bindings.map(binding => ({ ...binding, to: binding.kind === 'frame' ? `robot_${binding.from}` : binding.to }))
  );
  expect((mapped.documents[2].data as any).panels[0].visualization.displayedTfFrames).toEqual(['robot_panda_link0']);
});
describe('transactional snapshots', () => {
  it('commits all collections and cached releases with provenance without activating anything', async () => {
    const items = [
      makeCollection(starter(), {
        sourceId: 'official',
        itemId: 'panda',
        version: '1.0.0',
        sha256: bundledReleases[0].sha256,
      }),
      makeCollection(starter()),
    ];
    await writeLibrary({ collections: items, releases: bundledReleases, sources: [officialSource] });
    const saved = await readLibrarySnapshot();
    expect(saved.collections).toHaveLength(2);
    expect(saved.collections.find(item => item.id === items[0].id)!.origin).toEqual(items[0].origin);
    expect(saved.releases).toHaveLength(bundledReleases.length);
    expect(getLibraryPads()).toEqual([]);
  });
  it('aborts every write on identity collision, cancellation or uncloneable data', async () => {
    const existing = makeCollection(starter());
    await writeLibrary({ collections: [existing] });
    await expect(
      writeLibrary({ collections: [makeCollection(starter()), existing], sources: [officialSource] })
    ).rejects.toBeTruthy();
    expect((await readLibrarySnapshot()).collections).toHaveLength(1);
    expect((await readLibrarySnapshot()).sources).toHaveLength(0);
    const signal = new AbortController();
    signal.abort();
    await expect(writeLibrary({ collections: [makeCollection(starter())] }, signal.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const item = makeCollection(starter());
    (item as any).bad = () => {};
    await expect(writeLibrary({ collections: [makeCollection(starter()), item] })).rejects.toBeTruthy();
    expect((await readLibrarySnapshot()).collections).toHaveLength(1);
  });
  it('rejects stale concurrent metadata changes and archives without breaking existing references', async () => {
    const item = makeCollection(starter());
    await writeLibrary({ collections: [item] });
    await writeLibrary({
      updateCollections: [{ collection: { ...item, title: 'Other window' }, expectedRevision: 0 }],
    });
    await expect(
      writeLibrary({ updateCollections: [{ collection: { ...item, title: 'Lost update' }, expectedRevision: 0 }] })
    ).rejects.toThrow();
    const current = (await readLibrarySnapshot()).collections[0];
    expect(current.title).toBe('Other window');
    expect(current.revision).toBe(1);
    await writeLibrary({
      updateCollections: [{ collection: { ...current, archivedAt: Date.now() }, expectedRevision: 1 }],
    });
    setLibrarySnapshot((await readLibrarySnapshot()).collections);
    expect(getLibraryPads()).toHaveLength(0);
    expect(getLibraryPad(libraryDocumentId(item.id, 'pad/joints'))).toBeTruthy();
    expect(getLibraryTree(libraryDocumentId(item.id, 'bt/readiness'))).toBeTruthy();
  });
});

describe('repeat imports and item removal', () => {
  it('deduplicates a batch and concurrent imports by complete contents, not names or object key order', async () => {
    const pack = starter();
    const { documents, ...envelope } = pack;
    const reordered = { documents, ...envelope };
    const results = await Promise.all([
      writeLibrary({ importCollections: [makeCollection(pack), makeCollection(reordered)] }),
      writeLibrary({ importCollections: [makeCollection(starter())] }),
    ]);
    expect(results.reduce((sum, result) => sum + result.imported, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(2);
    expect((await readLibrarySnapshot()).collections).toHaveLength(1);
    const different = starter();
    (different.documents[0].data as any).description = 'Different controls';
    await writeLibrary({ importCollections: [makeCollection(different)] });
    expect((await readLibrarySnapshot()).collections).toHaveLength(2);
  });
  it('hides a removed document from pickers, preserves dependencies and restores on explicit reimport', async () => {
    const item = makeCollection(starter());
    await writeLibrary({ importCollections: [item] });
    await writeLibrary({
      updateCollections: [{ collection: { ...item, removedDocumentIds: ['pad/joints'] }, expectedRevision: 0 }],
    });
    setLibrarySnapshot((await readLibrarySnapshot()).collections);
    expect(getLibraryPads()).toHaveLength(0);
    const id = libraryDocumentId(item.id, 'pad/joints');
    expect(getLibraryPad(id)).toBeTruthy();
    const request = openLibraryDocument(item, item.package.documents[2]);
    expect(request.workspace!.panels.some(panel => panel.layoutId === id)).toBe(true);
    expect(packageSavedWorkspace(request.workspace!).documents.some(doc => doc.kind === 'pad')).toBe(true);
    expect(await writeLibrary({ importCollections: [makeCollection(starter())] })).toEqual({ imported: 1, skipped: 0 });
    const snapshot = await readLibrarySnapshot();
    expect(snapshot.collections).toHaveLength(1);
    expect(snapshot.collections[0].id).toBe(item.id);
    expect(snapshot.collections[0].removedDocumentIds).toBeUndefined();
  });
  it('imports updated releases explicitly and preserves the old IDs while hiding their picker entries', async () => {
    const origin = { sourceId: 'official', itemId: 'panda', version: '1.0.0', sha256: 'a'.repeat(64) };
    const item = makeCollection(starter(), origin);
    await writeLibrary({ importCollections: [item] });
    const next = makeCollection(
      { ...starter(), version: '1.1.0' },
      { ...origin, version: '1.1.0', sha256: 'b'.repeat(64) }
    );
    await writeLibrary({ importCollections: [next] });
    const snapshot = await readLibrarySnapshot();
    expect(snapshot.collections).toHaveLength(2);
    expect(snapshot.collections.find(stored => stored.id === item.id)!.archivedAt).toBeTruthy();
    setLibrarySnapshot(snapshot.collections);
    expect(getLibraryPads().map(pad => pad.id)).toEqual([libraryDocumentId(next.id, 'pad/joints')]);
    expect(getLibraryPad(libraryDocumentId(item.id, 'pad/joints'))).toBeTruthy();
  });
  it('rolls back the complete deduplicating import on a storage failure', async () => {
    const bad = makeCollection(starter());
    (bad as any).uncloneable = () => {};
    // Use different content to ensure the failing record reaches the database.
    bad.package.title = 'Fail';
    await expect(
      writeLibrary({ importCollections: [makeCollection(starter()), bad], sources: [officialSource] })
    ).rejects.toBeTruthy();
    expect((await readLibrarySnapshot()).collections).toHaveLength(0);
    expect((await readLibrarySnapshot()).sources).toHaveLength(0);
  });
});
