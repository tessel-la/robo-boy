import { valid } from 'semver';
import { collection, record, text } from './json';

export type ContentKind = 'pad' | 'behaviorTree' | 'workspace';
export interface ContentDocument {
  id: string;
  kind: ContentKind;
  formatVersion: 1;
  data: unknown;
}
export interface ContentPackage {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  entryDocument: string;
  documents: ContentDocument[];
}
/** Envelope validation only. Each owner must validate every document body before use. */
export function readContentPackage(value: unknown): ContentPackage | null {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value)) return null;
  const data = record(value, 'Package');
  if (data.schemaVersion !== 1) throw new Error('Unsupported content package schema version.');
  // Bindings/compatibility become supported with catalogs; never silently ignore their constraints.
  const allowed = new Set(['schemaVersion', 'id', 'version', 'title', 'entryDocument', 'documents']);
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw new Error(`Unsupported package field: ${key}.`);
  text(data.id, 'Package id');
  text(data.title, 'Package title');
  text(data.entryDocument, 'Entry document');
  if (typeof data.version !== 'string' || !valid(data.version))
    throw new Error('Package version must be a semantic version.');
  const ids = new Set<string>();
  for (const item of collection(data.documents, 'Documents', 100)) {
    const doc = record(item, 'Document');
    for (const key of Object.keys(doc))
      if (!['id', 'kind', 'formatVersion', 'data'].includes(key))
        throw new Error(`Unsupported document field: ${key}.`);
    text(doc.id, 'Document id');
    if (ids.has(doc.id)) throw new Error('Document ids must be unique.');
    ids.add(doc.id);
    if (!['pad', 'behaviorTree', 'workspace'].includes(doc.kind) || doc.formatVersion !== 1 || !('data' in doc))
      throw new Error('Unsupported document kind or format version.');
  }
  if (!ids.has(data.entryDocument)) throw new Error('Entry document is missing.');
  return data as ContentPackage;
}
