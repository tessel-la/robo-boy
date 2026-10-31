import { gt } from 'semver';
import { ManagementDialogHeader } from '../../components/management/ManagementDialogHeader';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createUuid } from '../../utils/uuid';
import { importError, MAX_CONTENT_BYTES, parseContentJson, readContentFile, record } from './json';
import { documentKinds, readLibraryPackage, validateLibraryPackage, type LibraryPackage } from './content';
import { catalogUrl, fetchContent, readCatalog, readLibraryFolder, resolveRelease } from './catalog';
import {
  writeLibrary,
  makeCollection,
  type LibraryCollection,
  type LibrarySource,
  type CatalogItem,
  type CachedRelease,
} from './store';
import { catalogSources, bundledReleases, OFFICIAL_SOURCE_ID } from './official';
import { libraryDocumentId, openLibraryDocument, type LibraryOpenRequest } from './runtime';
import { readSavedContent, removeSavedContent, type SavedContent } from './savedContent';
import type { LibraryData, LibraryFilter } from './LibraryProvider';
import type { ContentDocument } from './packages';
import { checkCatalogSources } from './updates';
import { groupLibraryDocuments, type LibraryDocumentEntry } from './documents';
import './LibraryDialog.css';
const documentName = (doc: ContentDocument) => {
  const data = doc.data as { name?: string; title?: string };
  return data.name ?? data.title ?? doc.id;
};
interface Preview {
  package: LibraryPackage;
  origin?: LibraryCollection['origin'];
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
  const [updateCheckFailed, setUpdateCheckFailed] = useState(false);
  const [newSources, setNewSources] = useState<string[]>([]);
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
  useEffect(() => {
    const check = new AbortController();
    void checkCatalogSources(check.signal)
      .then(async result => {
        if (check.signal.aborted) return;
        setUpdateCheckFailed(result.failed);
        setNewSources(result.newSources);
        await refresh();
      })
      .catch(() => {
        if (!check.signal.aborted) setUpdateCheckFailed(true);
      });
    return () => check.abort();
  }, [refresh]);
  const sources = catalogSources(data.sources);
  const source = sourceId === 'mine' ? undefined : sources.find(source => source.id === sourceId);
  const releases = useMemo(
    () => new Map([...bundledReleases, ...data.releases].map(item => [item.sha256, item])),
    [data.releases]
  );
  const importedDocuments = useMemo(
    () => groupLibraryDocuments(data.collections, showArchived),
    [data.collections, showArchived]
  );
  const rows = source
    ? source.catalog.items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        kinds: item.kinds ?? (item.kind === 'collection' ? [] : [item.kind]),
        catalog: item,
        members: undefined as LibraryDocumentEntry[] | undefined,
        documentId: undefined as string | undefined,
        collection: undefined as LibraryCollection | undefined,
        saved: undefined as SavedContent | undefined,
      }))
    : [
        ...importedDocuments.map(({ collection, document, members }) => ({
          id: libraryDocumentId(collection.id, document.id),
          title: documentName(document),
          description: [
            ...new Set(
              members.map(
                ({ collection }) =>
                  `${collection.title} · ${collection.package.version}${collection.archivedAt ? ' · Archived' : ''}`
              )
            ),
          ].join(' · '),
          kinds: [document.kind],
          documentId: document.id,
          collection,
          members,
          catalog: undefined as CatalogItem | undefined,
          saved: undefined as SavedContent | undefined,
        })),
        ...saved.items.map(item => ({
          id: item.id,
          title: item.title,
          description: 'Saved on this device',
          kinds: documentKinds(item.package),
          saved: item,
          members: undefined as LibraryDocumentEntry[] | undefined,
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
          collection: row.collection,
          documentId: row.documentId,
        },
      ]);

      return;
    }
    if (row.saved) {
      setPreview([{ package: row.saved.package, saved: row.saved }]);
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
      const collections = preview.map(item => makeCollection(item.package, item.origin));
      const result = await writeLibrary({ importCollections: collections }, signal);
      await refresh();
      if (signal.aborted) return;
      setSelected([]);
      setSelecting(false);
      setReviewing(false);
      setPreview([]);
      setNotice(result.imported ? 'Imported successfully.' : 'Already imported.');
      requestAnimationFrame(() => itemsPanel.current?.focus());
    });
  const readFile = (file: File) =>
    run(async signal => {
      const text = await readContentFile(file, signal);
      const raw = parseContentJson(text);
      let packages: LibraryPackage[];
      if (raw && typeof raw === 'object' && 'libraryBackupVersion' in raw) {
        const backup = record(raw, 'Catalog backup');
        if (
          backup.libraryBackupVersion !== 1 ||
          !Array.isArray(backup.collections) ||
          !backup.collections.length ||
          backup.collections.length > 100
        )
          throw new Error('Unsupported Catalog backup.');
        packages = backup.collections.map(validateLibraryPackage);
      } else packages = [readLibraryPackage(text, file.name.replace(/\.json$/i, ''))];
      setPreview(packages.map(pack => ({ package: pack })));
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
        (selected.length ? rows.filter(row => selected.includes(row.id)) : rows)
          .flatMap(row =>
            row.members ? row.members.map(member => ({ ...row, collection: member.collection })) : [row]
          )
          .map(row => [row.collection?.id ?? row.id, row])
      ).values(),
    ];
    const packages = chosen
      .map(row => (row.collection ? { ...row.collection.package, title: row.collection.title } : row.saved?.package))
      .filter(Boolean);
    if (packages.length) download({ libraryBackupVersion: 1, collections: packages }, 'roboboy-catalog.json');
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
    changes: Partial<Pick<LibraryCollection, 'title' | 'archivedAt' | 'removedDocumentIds'>>
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
        changes.removedDocumentIds
          ? 'Removed.'
          : changes.archivedAt
            ? 'Collection archived. Open layouts still work.'
            : 'Saved.'
      );
    });
  const updates = (item: LibraryCollection) => {
    const origin = item.origin;
    if (!origin) return undefined;
    const latest = sources
      .find(source => source.id === origin.sourceId)
      ?.catalog.items.find(entry => entry.id === origin.itemId);
    return latest &&
      (gt(latest.version, origin.version) || (latest.version === origin.version && latest.sha256 !== origin.sha256))
      ? latest
      : undefined;
  };
  const pendingUpdates = data.collections.filter(
    item =>
      !item.archivedAt &&
      item.package.documents.some(doc => !item.removedDocumentIds?.includes(doc.id)) &&
      updates(item)
  );
  const reviewUpdates = () => {
    const item = pendingUpdates[0];
    if (!item?.origin) {
      if (newSources[0]) chooseSource(newSources[0]);
      return;
    }
    chooseSource(item.origin.sourceId);
    setSelected([item.origin.itemId]);
  };
  const removeRow = (id: string) => {
    const row = rows.find(row => row.id === id);
    if (row?.collection && row.documentId) {
      setPreview([]);
      void run(async signal => {
        const changes = new Map<string, LibraryCollection>();
        for (const { collection, document } of row.members!) {
          const current = changes.get(collection.id) ?? collection;
          changes.set(collection.id, {
            ...current,
            removedDocumentIds: [...new Set([...(current.removedDocumentIds ?? []), document.id])],
          });
        }
        await writeLibrary(
          {
            updateCollections: [...changes.values()].map(collection => ({
              collection,
              expectedRevision: collection.revision ?? 0,
            })),
          },
          signal
        );
        await refresh();
        if (signal.aborted) return;
        setConfirmDelete(null);
        setNotice('Removed.');
        requestAnimationFrame(() => itemsPanel.current?.focus());
      });
    } else if (row?.saved) {
      void run(async () => {
        removeSavedContent(row.saved!);
        setSaved(readSavedContent());
        setPreview([]);
        setConfirmDelete(null);
        setNotice('Removed.');
      });
    }
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
        title="Catalog"
        titleId="library-title"
        subtitle="Layouts, Pads & behavior trees"
        closeLabel="Close Catalog"
        onClose={onClose}
      />

      <div className="library-toolbar">
        <nav aria-label="Catalog views">
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
          aria-label="Catalog file"
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
          aria-label="Catalog folder"
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
        {(pendingUpdates.length > 0 || newSources.length > 0) && (
          <div className="library-update-notice" role="status">
            <span>{pendingUpdates.length ? 'Catalog updates available.' : 'New catalog items available.'}</span>
            <button disabled={busy} onClick={reviewUpdates}>
              Review updates
            </button>
          </div>
        )}
        {updateCheckFailed && <p>Couldn’t check for updates. Saved content is available.</p>}
        {(error || storageError) && <p role="alert">{error || storageError}</p>}
        {storageError && <button onClick={() => void refresh()}>Retry storage</button>}
      </div>
      <div className={`library-layout${preview.length || busy ? ' library-has-preview' : ''}`}>
        <section ref={itemsPanel} tabIndex={-1} className="library-items" aria-label="Catalog content">
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
                <button className="library-item-button" disabled={busy} onClick={() => void selectRow(row.id)}>
                  <strong>{row.title}</strong>
                  <span>
                    {row.kinds
                      .map(kind =>
                        kind === 'behaviorTree' ? 'Behavior tree' : kind === 'workspace' ? 'Layout' : 'Pad'
                      )
                      .join(' · ')}
                  </span>
                  <small>{source ? `Version ${row.catalog?.version}` : row.description}</small>
                  {row.collection && updates(row.collection) && <em>Update available</em>}
                </button>
                {!source &&
                  (confirmDelete === row.id ? (
                    <div className="library-remove-actions">
                      <button
                        disabled={busy}
                        aria-label={`Confirm remove ${row.title}`}
                        onClick={() => removeRow(row.id)}
                      >
                        Remove
                      </button>
                      <button disabled={busy} onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="library-remove"
                      disabled={busy || !!storageError}
                      aria-label={`Remove ${row.title}`}
                      title={`Remove ${row.title}`}
                      onClick={() => setConfirmDelete(row.id)}
                    >
                      ×
                    </button>
                  ))}
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
              <h3>{reviewing ? 'Import contents' : 'Preview'}</h3>
              {preview.map((item, index) => (
                <article key={`${item.package.id}:${index}`}>
                  <h4>
                    {item.documentId
                      ? documentName(item.package.documents.find(doc => doc.id === item.documentId)!)
                      : (item.collection?.title ?? item.saved?.title ?? item.package.title)}
                  </h4>
                  {item.package.documents
                    .filter(doc => !item.documentId || doc.id === item.documentId)
                    .map(doc => (
                      <div className="library-document" key={doc.id}>
                        <span>
                          <strong>{documentName(doc)}</strong>
                          <small>
                            {doc.kind === 'workspace'
                              ? `Layout · ${(doc.data as any).panels.length} panels`
                              : doc.kind === 'behaviorTree'
                                ? 'Behavior tree'
                                : 'Pad'}
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
                  {!reviewing && (
                    <details className="library-options">
                      <summary>Details{item.collection ? ' & collection' : ''}</summary>
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
