import { ManagementDialogHeader } from '../../components/management/ManagementDialogHeader';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createUuid } from '../../utils/uuid';
import { importError, MAX_CONTENT_BYTES, parseContentJson, readContentFile, record } from './json';
import {
  bindPackage,
  documentKinds,
  packageBindings,
  readLibraryPackage,
  validateLibraryPackage,
  type Binding,
  type LibraryPackage,
} from './content';
import { catalogUrl, fetchContent, readCatalog, readLibraryFolder, resolveRelease } from './catalog';
import {
  writeLibrary,
  makeCollection,
  type LibraryCollection,
  type LibrarySource,
  type CatalogItem,
  type CachedRelease,
} from './store';
import { officialSource, bundledReleases, OFFICIAL_SOURCE_ID } from './official';
import { openLibraryDocument, type LibraryOpenRequest } from './runtime';
import { readSavedContent, type SavedContent } from './savedContent';
import type { LibraryData, LibraryFilter } from './LibraryProvider';
import './LibraryDialog.css';
interface Preview {
  package: LibraryPackage;
  origin?: LibraryCollection['origin'];
  bindings: Binding[];
  collection?: LibraryCollection;
  saved?: SavedContent;
}
interface Props {
  initialFilter: LibraryFilter;
  data: LibraryData;
  storageError: string;
  refresh: () => Promise<void>;
  onClose: () => void;
  onUse: (request: LibraryOpenRequest) => void;
}
export default function LibraryDialog({ initialFilter, data, storageError, refresh, onClose, onUse }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  const [sourceId, setSourceId] = useState('mine');
  const [kind, setKind] = useState<LibraryFilter>(initialFilter);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [saved, setSaved] = useState(() => readSavedContent());
  const [folderRefresh, setFolderRefresh] = useState<string>();
  useEffect(() => {
    const prior = document.activeElement;
    dialog.current?.showModal();
    const changed = () => setSaved(readSavedContent());
    for (const name of [
      'storage',
      'robo-boy-gamepads-changed',
      'robo-boy-behavior-trees-changed',
      'robo-boy-workspaces-changed',
    ])
      window.addEventListener(name, changed);
    return () => {
      controller.current.abort();
      for (const name of [
        'storage',
        'robo-boy-gamepads-changed',
        'robo-boy-behavior-trees-changed',
        'robo-boy-workspaces-changed',
      ])
        window.removeEventListener(name, changed);
      if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
    };
  }, []);
  const savedOfficial = data.sources.find(source => source.id === OFFICIAL_SOURCE_ID);
  const sources = [
    // A catalog's relative paths belong to its endpoint. Reset the source when
    // an app update moves Official, retaining independent imported collections.
    savedOfficial && savedOfficial.url === officialSource.url ? savedOfficial : officialSource,
    ...data.sources.filter(source => source.id !== OFFICIAL_SOURCE_ID),
  ];
  const source = sourceId === 'mine' ? undefined : sources.find(source => source.id === sourceId);
  const releases = useMemo(
    () => new Map([...bundledReleases, ...data.releases].map(item => [item.sha256, item])),
    [data.releases]
  );
  const rows = source
    ? source.catalog.items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        kinds: item.kinds ?? (item.kind === 'collection' ? [] : [item.kind]),
        catalog: item,
        collection: undefined as LibraryCollection | undefined,
        saved: undefined as SavedContent | undefined,
      }))
    : [
        ...data.collections
          .filter(item => showArchived || !item.archivedAt)
          .map(item => ({
            id: item.id,
            title: item.title,
            description: item.archivedAt ? 'Archived · references preserved' : item.package.description,
            kinds: documentKinds(item.package),
            collection: item,
            catalog: undefined as CatalogItem | undefined,
            saved: undefined as SavedContent | undefined,
          })),
        ...saved.items.map(item => ({
          id: item.id,
          title: item.title,
          description: 'Saved on this device',
          kinds: documentKinds(item.package),
          saved: item,
          collection: undefined as LibraryCollection | undefined,
          catalog: undefined as CatalogItem | undefined,
        })),
      ];
  const visible = rows.filter(
    row =>
      (kind === 'all' || row.kinds.includes(kind)) &&
      `${row.title} ${row.description ?? ''} ${row.catalog?.tags?.join(' ') ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    controller.current.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation(signal);
    } catch (error) {
      if (!signal.aborted) setError(importError(error));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  };
  const chooseSource = (id: string) => {
    controller.current.abort();
    controller.current = new AbortController();
    setBusy(false);
    setSourceId(id);
    setSelected([]);
    setPreview([]);
    setReviewing(false);
    setError('');
    setNotice('');
    setConfirmDelete(null);
  };
  const selectRow = async (id: string) => {
    const row = rows.find(row => row.id === id);
    if (!row) return;
    controller.current.abort();
    controller.current = new AbortController();
    setBusy(false);
    setConfirmDelete(null);
    setReviewing(false);
    if (row.collection) {
      setPreview([
        {
          package: row.collection.package,
          bindings: packageBindings(row.collection.package),
          collection: row.collection,
        },
      ]);

      return;
    }
    if (row.saved) {
      setPreview([{ package: row.saved.package, bindings: packageBindings(row.saved.package), saved: row.saved }]);
      return;
    }
    if (row.catalog && source)
      await run(async signal => {
        const release = await resolveRelease(source, row.catalog!, releases.get(row.catalog!.sha256), signal);
        if (signal.aborted) return;
        if (!releases.has(release.sha256)) await writeLibrary({ releases: [release] }, signal);
        setPreview([
          {
            package: release.package,
            bindings: packageBindings(release.package),
            origin: {
              sourceId: source.id,
              itemId: row.catalog!.id,
              version: row.catalog!.version,
              sha256: release.sha256,
            },
          },
        ]);
      });
  };
  const prepareImport = () =>
    run(async signal => {
      const ids = selected.length
        ? selected
        : !preview.length && source
          ? visible.map(row => row.id)
          : (preview
              .map(item => item.origin?.itemId ?? item.collection?.id ?? item.saved?.id)
              .filter(Boolean) as string[]);
      const plans: Preview[] = [];
      const downloaded: CachedRelease[] = [];
      let totalBytes = 0;
      for (const id of ids) {
        const row = rows.find(row => row.id === id);
        if (row?.catalog && source) {
          const release = await resolveRelease(source, row.catalog, releases.get(row.catalog.sha256), signal);
          if (signal.aborted) return;
          totalBytes += new TextEncoder().encode(release.source).byteLength;
          if (totalBytes > 32 * 1024 * 1024) throw new Error('Select fewer collections (32 MiB maximum per import).');
          downloaded.push(release);
          plans.push({
            package: release.package,
            bindings: packageBindings(release.package),
            origin: {
              sourceId: source.id,
              itemId: row.catalog.id,
              version: row.catalog.version,
              sha256: release.sha256,
            },
          });
        } else if (row?.collection || row?.saved) {
          const pack = (row.collection ?? row.saved)!.package;
          plans.push({ package: pack, bindings: packageBindings(pack) });
        }
      }
      if (!plans.length) throw new Error('Select content to import.');
      if (downloaded.length) await writeLibrary({ releases: downloaded }, signal);
      if (signal.aborted) return;
      setPreview(plans);
      setReviewing(true);
    });
  const commitImport = () =>
    run(async signal => {
      const collections = preview.map(item => makeCollection(bindPackage(item.package, item.bindings), item.origin));
      await writeLibrary({ collections }, signal);
      await refresh();
      setSourceId('mine');
      setSelected([]);
      setReviewing(false);
      setPreview(
        collections.map(collection => ({
          package: collection.package,
          collection,
          bindings: packageBindings(collection.package),
        }))
      );
      setNotice(
        `Imported ${collections.length} collection${collections.length === 1 ? '' : 's'}. Choose a document below to open it.`
      );
    });
  const readFile = (file: File) =>
    run(async signal => {
      const text = await readContentFile(file, signal);
      const raw = parseContentJson(text);
      let packages: LibraryPackage[];
      if (raw && typeof raw === 'object' && 'libraryBackupVersion' in raw) {
        const backup = record(raw, 'Library backup');
        if (
          backup.libraryBackupVersion !== 1 ||
          !Array.isArray(backup.collections) ||
          !backup.collections.length ||
          backup.collections.length > 100
        )
          throw new Error('Unsupported Library backup.');
        packages = backup.collections.map(validateLibraryPackage);
      } else packages = [readLibraryPackage(text, file.name.replace(/\.json$/i, ''))];
      setPreview(packages.map(pack => ({ package: pack, bindings: packageBindings(pack) })));
      setReviewing(true);
    });
  const readFolder = (files: File[]) =>
    run(async signal => {
      const result = await readLibraryFolder(files, signal, folderRefresh);
      await writeLibrary({ sources: [result.source], releases: result.releases }, signal);
      await refresh();
      setSourceId(result.source.id);
      setSelected(result.source.catalog.items.map(item => item.id));
      setPreview([]);
      setReviewing(false);
      setNotice(
        `Folder available offline. ${result.skipped} unrelated JSON file${result.skipped === 1 ? '' : 's'} ignored. Select entries or import the collection.`
      );
      setFolderRefresh(undefined);
    });
  const addSource = () =>
    run(async signal => {
      const normalized = catalogUrl(url);
      const previous = data.sources.find(source => source.url === normalized);
      const catalog = readCatalog(await fetchContent(normalized, signal));
      const next: LibrarySource = {
        id: previous?.id ?? createUuid(),
        title: catalog.title,
        type: 'https',
        url: normalized,
        catalog,
        updatedAt: Date.now(),
      };
      await writeLibrary({ sources: [next] }, signal);
      await refresh();
      setSourceId(next.id);
      setSelected([]);
      setPreview([]);
      setAddingSource(false);
      setUrl('');
    });
  const refreshSource = () =>
    run(async signal => {
      if (!source) return;
      if (source.type === 'folder') {
        setFolderRefresh(source.id);
        folderInput.current?.click();
        return;
      }
      const catalog = readCatalog(await fetchContent(source.url!, signal));
      await writeLibrary({ sources: [{ ...source, catalog, updatedAt: Date.now() }] }, signal);
      await refresh();
      setNotice('Catalog refreshed. Existing copies are unchanged.');
    });
  const download = (value: unknown, name: string) => {
    const text = JSON.stringify(value, null, 2);
    if (new TextEncoder().encode(text).length > MAX_CONTENT_BYTES) {
      setError('Export selected collections separately; each file is limited to 5 MiB.');
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[^a-z0-9_.-]/gi, '_');
    a.click();
    URL.revokeObjectURL(url);
  };
  const exported = () => {
    const chosen = selected.length ? rows.filter(row => selected.includes(row.id)) : rows;
    const packages = chosen
      .map(row => (row.collection ? { ...row.collection.package, title: row.collection.title } : row.saved?.package))
      .filter(Boolean);
    if (packages.length) download({ libraryBackupVersion: 1, collections: packages }, 'roboboy-library.json');
  };
  const openDocument = (item: Preview, docId: string) => {
    const doc = item.package.documents.find(doc => doc.id === docId)!;
    if (item.saved) {
      if (doc.kind === 'pad' && item.saved.padId) {
        onUse({ id: createUuid(), kind: 'pad', padId: item.saved.padId });
        return;
      }
      if (doc.kind === 'behaviorTree' && item.saved.treeId) {
        onUse({ id: createUuid(), kind: 'behaviorTree', tree: doc.data as LibraryOpenRequest['tree'] });
        return;
      }
      void run(async signal => {
        const collection = makeCollection(item.package);
        await writeLibrary({ collections: [collection] }, signal);
        await refresh();
        if (!signal.aborted) onUse(openLibraryDocument(collection, doc));
      });
      return;
    }
    if (item.collection) onUse(openLibraryDocument(item.collection, doc));
  };
  const updateCollection = (
    item: LibraryCollection,
    changes: Partial<Pick<LibraryCollection, 'title' | 'archivedAt'>>
  ) =>
    run(async signal => {
      const next = { ...item, ...changes, revision: (item.revision ?? 0) + 1 };
      await writeLibrary({ updateCollections: [{ collection: next, expectedRevision: item.revision ?? 0 }] }, signal);
      await refresh();
      setPreview(previous =>
        previous.map(entry => (entry.collection?.id === next.id ? { ...entry, collection: next } : entry))
      );
      setConfirmDelete(null);
      setNotice(
        changes.archivedAt ? 'Collection archived. Workspace references remain available.' : 'Collection updated.'
      );
    });
  const updates = (item: LibraryCollection) => {
    const origin = item.origin;
    if (!origin) return undefined;
    const latest = sources
      .find(source => source.id === origin.sourceId)
      ?.catalog.items.find(entry => entry.id === origin.itemId);
    return latest && latest.sha256 !== origin.sha256 ? latest : undefined;
  };
  return (
    <dialog
      ref={dialog}
      className="library-dialog"
      aria-labelledby="library-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <ManagementDialogHeader
        title="Library"
        titleId="library-title"
        subtitle="Workspaces, behavior trees and Pads"
        closeLabel="Close Library"
        onClose={onClose}
      />

      <div className="library-toolbar">
        <button disabled={busy || !!storageError} onClick={() => fileInput.current?.click()}>
          Import file
        </button>
        <button
          disabled={busy || !!storageError}
          onClick={() => {
            setFolderRefresh(undefined);
            folderInput.current?.click();
          }}
        >
          Add folder
        </button>
        <button disabled={busy || !!storageError} onClick={() => setAddingSource(value => !value)}>
          Add catalog
        </button>
        {sourceId === 'mine' && (
          <button disabled={busy || !rows.length} onClick={exported}>
            Export {selected.length ? 'selected' : 'all'}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Library file"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void readFile(file);
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          aria-label="Library folder"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length) void readFolder(files);
          }}
        />
      </div>
      {addingSource && (
        <form
          className="library-add-source"
          onSubmit={event => {
            event.preventDefault();
            void addSource();
          }}
        >
          <label>
            Catalog URL
            <input
              value={url}
              onChange={event => setUrl(event.target.value)}
              type="url"
              required
              placeholder="https://…/catalog.json"
            />
          </label>
          <button disabled={busy}>Add source</button>
        </form>
      )}
      <div className="library-messages" aria-live="polite">
        {busy && <p role="status">Working…</p>}
        {notice && <p role="status">{notice}</p>}
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
        {storageError && <button onClick={() => void refresh()}>Retry storage</button>}
      </div>
      <div className="library-layout">
        <nav aria-label="Library sources">
          <button className={sourceId === 'mine' ? 'selected' : ''} onClick={() => chooseSource('mine')}>
            My library
          </button>
          {sources.map(source => (
            <button
              className={sourceId === source.id ? 'selected' : ''}
              key={source.id}
              onClick={() => chooseSource(source.id)}
            >
              {source.id === OFFICIAL_SOURCE_ID ? 'Official' : source.title}
              <small>
                {source.id === OFFICIAL_SOURCE_ID
                  ? 'Bundled + online'
                  : source.type === 'folder'
                    ? 'Folder snapshot'
                    : 'HTTPS catalog'}
              </small>
            </button>
          ))}
        </nav>
        <section className="library-items" aria-label="Library content">
          {sourceId === 'mine' && (
            <label className="library-check">
              <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
              Show archived collections
            </label>
          )}
          <div className="library-filters">
            <label className="library-search">
              Search
              <input value={search} onChange={event => setSearch(event.target.value)} type="search" />
            </label>
            <label>
              Kind
              <select value={kind} onChange={event => setKind(event.target.value as LibraryFilter)}>
                <option value="all">All</option>
                <option value="workspace">Workspaces</option>
                <option value="behaviorTree">Behavior trees</option>
                <option value="pad">Pads</option>
              </select>
            </label>
          </div>
          {source && (
            <div className="library-source-actions">
              <span>
                {source.updatedAt ? `Cached ${new Date(source.updatedAt).toLocaleDateString()}` : 'Available offline'}
              </span>
              <button disabled={busy} onClick={() => void refreshSource()}>
                Refresh{source.type === 'folder' ? ' folder' : ''}
              </button>
              {source.id !== OFFICIAL_SOURCE_ID && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async signal => {
                      await writeLibrary({ removeSources: [source.id] }, signal);
                      await refresh();
                      chooseSource('mine');
                    })
                  }
                >
                  Remove source
                </button>
              )}
            </div>
          )}
          {visible.length > 0 && (
            <label className="library-check">
              <input
                type="checkbox"
                checked={visible.every(row => selected.includes(row.id))}
                onChange={event => setSelected(event.target.checked ? visible.map(row => row.id) : [])}
              />
              Select all ({visible.length})
            </label>
          )}
          <div className="library-list">
            {visible.map(row => (
              <div className="library-row" key={row.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${row.title}`}
                  checked={selected.includes(row.id)}
                  onChange={event =>
                    setSelected(previous =>
                      event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id)
                    )
                  }
                />
                <button onClick={() => void selectRow(row.id)}>
                  <strong>{row.title}</strong>
                  <span>
                    {row.kinds.map(kind => (kind === 'behaviorTree' ? 'BT' : kind)).join(' · ')}
                    {row.catalog ? ` · ${row.catalog.version}` : ''}
                  </span>
                  <small>{row.description}</small>
                  {row.collection && updates(row.collection) && <em>Update available · import as a new copy</em>}
                </button>
              </div>
            ))}
            {!visible.length && <p>No matching content. Import a file, choose a folder or browse Official.</p>}
          </div>
          {sourceId === 'mine' && saved.warnings.length > 0 && (
            <details>
              <summary>{saved.warnings.length} saved item(s) need attention</summary>
              {saved.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </details>
          )}
          <button
            className="library-primary"
            disabled={busy || !!storageError || (!selected.length && !preview.length && !(source && visible.length))}
            onClick={() => void prepareImport()}
          >
            {source ? (selected.length ? 'Import selected' : 'Import all') : 'Create independent copies'}
          </button>
        </section>
        <section className="library-preview" aria-label="Content preview">
          {preview.length === 0 ? (
            <p>
              Select an item to preview its documents. Importing keeps your active workspace and controls unchanged.
            </p>
          ) : (
            <>
              <h3>{reviewing ? 'Review import' : 'Preview'}</h3>
              <p>
                {reviewing
                  ? 'Every selected collection will be saved together. Review robot names below before importing.'
                  : 'Imported collections are independent snapshots. Opening a document is a separate action.'}
              </p>
              {preview.map((item, index) => (
                <article key={`${item.package.id}:${index}`}>
                  <h4>{item.collection?.title ?? item.saved?.title ?? item.package.title}</h4>
                  <p>{item.package.description}</p>
                  <p className="library-meta">
                    Version {item.package.version}
                    {item.origin
                      ? ` · ${item.origin.sourceId === OFFICIAL_SOURCE_ID ? 'Official' : 'Custom source'}`
                      : ''}
                    {item.package.author ? ` · ${item.package.author}` : ''}
                    {item.package.license ? ` · ${item.package.license}` : ''}
                  </p>
                  {item.collection?.origin && (
                    <p>
                      Imported release: {item.collection.origin.version} · {item.collection.origin.sha256.slice(0, 12)}
                    </p>
                  )}
                  {item.package.documents.map(doc => (
                    <div className="library-document" key={doc.id}>
                      <span>
                        <strong>{(doc.data as any).name ?? (doc.data as any).title}</strong>
                        <small>
                          {doc.kind === 'behaviorTree'
                            ? `${(doc.data as any).nodes.length} nodes`
                            : doc.kind === 'pad'
                              ? `${(doc.data as any).components.length} components`
                              : `${(doc.data as any).panels.length} panels`}
                        </small>
                      </span>
                      {!reviewing && (item.collection || item.saved) && (
                        <button onClick={() => openDocument(item, doc.id)}>
                          {doc.kind === 'workspace'
                            ? 'Open workspace'
                            : doc.kind === 'behaviorTree'
                              ? 'Open BT'
                              : 'Add Pad'}
                        </button>
                      )}
                    </div>
                  ))}
                  {reviewing && item.bindings.length > 0 && (
                    <details open>
                      <summary>Robot names and frames ({item.bindings.length})</summary>
                      {item.bindings.map((binding, bindingIndex) => (
                        <label className="library-binding" key={`${binding.kind}:${binding.from}`}>
                          {binding.kind}: {binding.from}
                          <input
                            aria-label={`${binding.kind} ${binding.from}`}
                            value={binding.to}
                            onChange={event =>
                              setPreview(previous =>
                                previous.map((entry, entryIndex) =>
                                  entryIndex !== index
                                    ? entry
                                    : {
                                        ...entry,
                                        bindings: entry.bindings.map((value, valueIndex) =>
                                          valueIndex !== bindingIndex ? value : { ...value, to: event.target.value }
                                        ),
                                      }
                                )
                              )
                            }
                          />
                        </label>
                      ))}
                    </details>
                  )}
                  {!reviewing && (
                    <button
                      onClick={() =>
                        download(
                          { ...item.package, title: item.collection?.title ?? item.package.title },
                          `${item.collection?.title ?? item.package.title}.roboboy.json`
                        )
                      }
                    >
                      Export collection
                    </button>
                  )}
                  {item.collection && !reviewing && (
                    <>
                      <label className="library-binding">
                        Collection name
                        <input
                          aria-label="Collection name"
                          value={names[item.collection.id] ?? item.collection.title}
                          onChange={event =>
                            setNames(previous => ({ ...previous, [item.collection!.id]: event.target.value }))
                          }
                        />
                      </label>
                      <button
                        disabled={busy || !(names[item.collection.id] ?? item.collection.title).trim()}
                        onClick={() =>
                          void updateCollection(item.collection!, {
                            title: (names[item.collection!.id] ?? item.collection!.title).trim(),
                          })
                        }
                      >
                        Rename
                      </button>
                      {item.collection.archivedAt ? (
                        <button
                          disabled={busy}
                          onClick={() => void updateCollection(item.collection!, { archivedAt: undefined })}
                        >
                          Restore collection
                        </button>
                      ) : confirmDelete === item.collection.id ? (
                        <>
                          <span>Archive this collection? Workspace references are preserved.</span>
                          <button
                            disabled={busy}
                            onClick={() => void updateCollection(item.collection!, { archivedAt: Date.now() })}
                          >
                            Confirm archive
                          </button>
                        </>
                      ) : (
                        <button disabled={busy} onClick={() => setConfirmDelete(item.collection!.id)}>
                          Archive collection
                        </button>
                      )}
                      {updates(item.collection) && (
                        <button
                          onClick={() => {
                            const origin = item.collection!.origin!;
                            chooseSource(origin.sourceId);
                            setSelected([origin.itemId]);
                          }}
                        >
                          Review newer release
                        </button>
                      )}
                    </>
                  )}
                </article>
              ))}
              <p>
                Robot compatibility has not been checked. External panels must be installed separately; opaque settings
                and ROS approvals are excluded.
              </p>
              {reviewing && (
                <div className="library-review-actions">
                  <button
                    onClick={() => {
                      controller.current.abort();
                      controller.current = new AbortController();
                      setBusy(false);
                      setReviewing(false);
                      setPreview([]);
                    }}
                  >
                    Cancel import
                  </button>
                  <button
                    className="library-primary"
                    disabled={busy || !!storageError}
                    onClick={() => void commitImport()}
                  >
                    Import {preview.length} collection{preview.length === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </dialog>
  );
}
