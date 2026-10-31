import type { LibraryCollection } from './store';
import type { ContentDocument } from './packages';
import type { SavedWorkspaceLayout } from '../workspace/documents';

export interface LibraryDocumentEntry {
  collection: LibraryCollection;
  document: ContentDocument;
}
export interface LibraryDocumentGroup extends LibraryDocumentEntry {
  members: LibraryDocumentEntry[];
}

/** Object key order is immaterial; array order and every saved value remain significant. */
const contentKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]])
        )
      : item
  );

/** Shared package contents appear once in selection. Original IDs remain available to references. */
export function groupLibraryDocuments(collections: LibraryCollection[], showArchived = false): LibraryDocumentGroup[] {
  const groups = new Map<string, LibraryDocumentGroup>();
  const ordered = [...collections].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const collection of ordered) {
    if (collection.archivedAt && !showArchived) continue;
    const documents = new Map(collection.package.documents.map(doc => [doc.id, doc]));
    for (const document of collection.package.documents) {
      if (collection.removedDocumentIds?.includes(document.id)) continue;
      // Identical layout JSON can reference different Pad/BT definitions in different packages.
      const dependencies =
        document.kind === 'workspace'
          ? (document.data as SavedWorkspaceLayout).panels.map(panel => [
              panel.layoutId ? documents.get(panel.layoutId) : null,
              panel.treeId ? documents.get(panel.treeId) : null,
            ])
          : [];
      const key = contentKey([
        !!collection.archivedAt,
        document.kind,
        document.formatVersion,
        document.data,
        dependencies,
      ]);
      const entry = { collection, document };
      const existing = groups.get(key);
      if (existing) existing.members.push(entry);
      else groups.set(key, { ...entry, members: [entry] });
    }
  }
  return [...groups.values()];
}
