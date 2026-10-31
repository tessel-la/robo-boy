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
import { libraryDocumentId, openLibraryDocument, type LibraryOpenRequest } from './runtime';
import { readSavedContent, type SavedContent } from './savedContent';
import type { LibraryData, LibraryFilter } from './LibraryProvider';
import type { ContentDocument } from './packages';
import './LibraryDialog.css';
const documentName = (doc: ContentDocument) => {
  const data = doc.data as { name?: string; title?: string };
  return data.name ?? data.title ?? doc.id;
};
interface Preview {
  package: LibraryPackage;
  origin?: LibraryCollection['origin'];
  bindings: Binding[];
  collection?: LibraryCollection;
  saved?: SavedContent;
  documentId?: string;
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
  const previewPanel = useRef<HTMLElement>(null);
  const itemsPanel = useRef<HTMLElement>(null);
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
  const [selecting, setSelecting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [saved, setSaved] = useState(() => readSavedContent());
  const [folderRefresh, setFolderRefresh] = useState<string>();
  useEffect(() => {
    if (preview.length && window.matchMedia?.('(max-width: 760px)').matches) previewPanel.current?.focus();
  }, [preview.length, reviewing]);
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
        documentId: undefined as string | undefined,
        collection: undefined as LibraryCollection | undefined,
        saved: undefined as SavedContent | undefined,
      }))
    : [
        ...data.collections
          .filter(item => showArchived || !item.archivedAt)
          .flatMap(item =>
            item.package.documents.map(doc => ({
              id: libraryDocumentId(item.id, doc.id),
              title: documentName(doc),
              description: item.archivedAt ? `${item.title} · Archived` : item.title,
              kinds: [doc.kind],
              documentId: doc.id,
              collection: item,
              catalog: undefined as CatalogItem | undefined,
              saved: undefined as SavedContent | undefined,
            }))
          ),
        ...saved.items.map(item => ({
          id: item.id,
          title: item.title,
          description: 'Saved on this device',
          kinds: documentKinds(item.package),
          saved: item,
          documentId: undefined as string | undefined,
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
    setSelecting(false);
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
          documentId: row.documentId,
        },
      ]);

      return;
    }
    if (row.saved) {
      setPreview([{ package: row.saved.package, bindings: packageBindings(row.saved.package), saved: row.saved }]);
      return;
    }
    setPreview([]);
    if (row.catalog && source)
      await run(async signal => {
        const release = await resolveRelease(source, row.catalog!, releases.get(row.catalog!.sha256), signal);
        if (signal.aborted) return;
        if (!releases.has(release.sha256)) await writeLibrary({ releases: [release] }, signal);
        if (signal.aborted) return;
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
  const prepareImport = (ids: string[]) =>
    run(async signal => {
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
      setNotice(`Imported ${collections.length} collection${collections.length === 1 ? '' : 's'}. Ready to open.`);
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
      setSelected([]);
      setSelecting(false);
      setPreview([]);
      setReviewing(false);
      setNotice(
        `Folder added. ${result.skipped ? `${result.skipped} unrelated JSON files skipped.` : 'Choose what to import.'}`
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
      setNotice('Catalog updated.');
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
    const chosen = [
      ...new Map(
        (selected.length ? rows.filter(row => selected.includes(row.id)) : rows).map(row => [
          row.collection?.id ?? row.id,
          row,
        ])
      ).values(),
    ];
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
      setNotice(changes.archivedAt ? 'Collection archived. Open layouts still work.' : 'Saved.');
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
        subtitle="Layouts, Pads & behavior trees"
        closeLabel="Close Library"
        onClose={onClose}
      />

      <div className="library-toolbar">
        <nav aria-label="Library views">
          <button aria-pressed={sourceId === 'mine'} onClick={() => chooseSource('mine')}>
            Saved
          </button>
          <button aria-pressed={sourceId !== 'mine'} onClick={() => chooseSource(OFFICIAL_SOURCE_ID)}>
            Browse
          </button>
        </nav>
        <details className="library-import-menu">
          <summary>Import</summary>
          <div>
            <button
              disabled={busy || !!storageError}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                fileInput.current?.click();
              }}
            >
              File…
            </button>
            <button
              disabled={busy || !!storageError}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setFolderRefresh(undefined);
                folderInput.current?.click();
              }}
            >
              Folder…
            </button>
            <button
              disabled={busy || !!storageError}
              onClick={event => {
                event.currentTarget.closest('details')?.removeAttribute('open');
                setAddingSource(value => !value);
              }}
            >
              Online catalog…
            </button>
          </div>
        </details>
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
      <div className={`library-layout${preview.length || busy ? ' library-has-preview' : ''}`}>
        <section ref={itemsPanel} tabIndex={-1} className="library-items" aria-label="Library content">
          {source && (
            <div className="library-source-picker">
              <label>
                Source
                <select value={sourceId} onChange={event => chooseSource(event.target.value)}>
                  {sources.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.id === OFFICIAL_SOURCE_ID ? 'Official' : item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} onClick={() => void refreshSource()}>
                Refresh
              </button>
            </div>
          )}
          <div className="library-filters">
            <label className="library-search">
              Search
              <input
                value={search}
                onChange={event => {
                  chooseSource(sourceId);
                  setSearch(event.target.value);
                }}
                type="search"
              />
            </label>
            <label>
              Type
              <select
                value={kind}
                onChange={event => {
                  chooseSource(sourceId);
                  setKind(event.target.value as LibraryFilter);
                }}
              >
                <option value="all">All</option>
                <option value="workspace">Layouts</option>
                <option value="behaviorTree">Behavior trees</option>
                <option value="pad">Pads</option>
              </select>
            </label>
          </div>
          {source && visible.length > 0 && (
            <div className="library-selection">
              <button
                aria-pressed={selecting}
                disabled={busy || reviewing}
                onClick={() => {
                  setSelecting(!selecting);
                  setSelected([]);
                }}
              >
                {selecting ? 'Done selecting' : 'Select multiple'}
              </button>
              {selecting && (
                <label className="library-check">
                  <input
                    type="checkbox"
                    disabled={busy || reviewing}
                    checked={visible.every(row => selected.includes(row.id))}
                    onChange={event => setSelected(event.target.checked ? visible.map(row => row.id) : [])}
                  />
                  Select all
                </label>
              )}
            </div>
          )}
          <div className="library-list">
            {visible.map(row => (
              <div className="library-row" key={row.id}>
                {selecting && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title}`}
                    disabled={busy || reviewing}
                    checked={selected.includes(row.id)}
                    onChange={event =>
                      setSelected(previous =>
                        event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id)
                      )
                    }
                  />
                )}
                <button onClick={() => void selectRow(row.id)}>
                  <strong>{row.title}</strong>
                  <span>
                    {row.kinds
                      .map(kind =>
                        kind === 'behaviorTree' ? 'Behavior tree' : kind === 'workspace' ? 'Layout' : 'Pad'
                      )
                      .join(' · ')}
                  </span>
                  <small>{row.description}</small>
                  {row.collection && updates(row.collection) && <em>Update available</em>}
                </button>
              </div>
            ))}
            {!visible.length && <p>No matching items. Browse Official or import a file.</p>}
          </div>
          {sourceId === 'mine' && saved.warnings.length > 0 && (
            <details>
              <summary>{saved.warnings.length} saved item(s) need attention</summary>
              {saved.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </details>
          )}
          {source ? (
            <>
              {!reviewing && (
                <button
                  className={selected.length ? 'library-primary' : undefined}
                  disabled={busy || !!storageError || !(selected.length || visible.length)}
                  onClick={() => void prepareImport(selected.length ? selected : visible.map(row => row.id))}
                >
                  {selected.length ? `Import selected (${selected.length})` : 'Import all'}
                </button>
              )}
              {source.id !== OFFICIAL_SOURCE_ID && (
                <details className="library-options">
                  <summary>Source details</summary>
                  <p>{source.type === 'folder' ? 'Folder saved on this device' : source.url}</p>
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
                </details>
              )}
            </>
          ) : (
            <details className="library-options">
              <summary>Saved options</summary>
              <button disabled={busy || !rows.length} onClick={exported}>
                Export all
              </button>
              <label className="library-check">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={event => {
                    chooseSource('mine');
                    setShowArchived(event.target.checked);
                  }}
                />
                Show archived collections
              </label>
            </details>
          )}
        </section>
        <section ref={previewPanel} tabIndex={-1} className="library-preview" aria-label="Content preview">
          <button
            className="library-back"
            onClick={() => {
              chooseSource(sourceId);
              requestAnimationFrame(() => itemsPanel.current?.focus());
            }}
          >
            ← Back
          </button>
          {preview.length === 0 ? (
            <p>Choose an item to see details and open or import it.</p>
          ) : (
            <>
              <h3>{reviewing ? 'Review import' : 'Preview'}</h3>
              {reviewing && <p>Check topics and frames before use. Importing does not run controls.</p>}
              {preview.map((item, index) => (
                <article key={`${item.package.id}:${index}`}>
                  <h4>
                    {item.documentId
                      ? documentName(item.package.documents.find(doc => doc.id === item.documentId)!)
                      : (item.collection?.title ?? item.saved?.title ?? item.package.title)}
                  </h4>
                  {!reviewing && !item.documentId && <p>{item.package.description}</p>}
                  {item.package.documents
                    .filter(doc => !item.documentId || doc.id === item.documentId)
                    .map(doc => (
                      <div className="library-document" key={doc.id}>
                        <span>
                          <strong>{documentName(doc)}</strong>
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
                              ? 'Open layout'
                              : doc.kind === 'behaviorTree'
                                ? 'Open tree'
                                : 'Add Pad'}
                          </button>
                        )}
                      </div>
                    ))}
                  {reviewing && item.bindings.length > 0 && (
                    <details>
                      <summary>Topics and frames ({item.bindings.length})</summary>
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
                    <details className="library-options">
                      <summary>Details{item.collection ? ' & collection' : ''}</summary>
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
                          Imported release: {item.collection.origin.version} ·{' '}
                          {item.collection.origin.sha256.slice(0, 12)}
                        </p>
                      )}
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
                              <span>Archive this collection? Open layouts still work.</span>
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
                    </details>
                  )}
                  {!reviewing && !item.collection && !item.saved && (
                    <button
                      className="library-primary"
                      disabled={busy || !!storageError}
                      onClick={() => void prepareImport([item.origin!.itemId])}
                    >
                      Import
                    </button>
                  )}
                </article>
              ))}
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
