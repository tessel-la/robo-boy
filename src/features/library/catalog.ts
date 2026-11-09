import { valid } from 'semver';
import { sha256 } from '../../panels/sha256';
import { collection, parseContentJson, record, text, MAX_CONTENT_BYTES, readContentFile } from './json';
import { readLibraryPackage, validateLibraryPackage, type LibraryPackage } from './content';
import type { Catalog, CatalogItem, LibrarySource, CachedRelease } from './store';
import { createUuid } from '../../utils/uuid';
export const contentHash = (source: string) =>
  Array.from(sha256(new TextEncoder().encode(source)), byte => byte.toString(16).padStart(2, '0')).join('');
export function catalogUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Use an HTTPS catalog URL without embedded credentials.');
  url.hash = '';
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && parts[2] === 'blob')
      return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}${url.search}`;
  }
  return url.href;
}
export function readCatalog(source: string): Catalog {
  const raw = record(parseContentJson(source), 'Catalog');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported Library catalog version.');
  text(raw.title, 'Catalog title');
  const ids = new Set<string>();
  const items = collection(raw.items, 'Catalog items', 100).map(value => {
    const item = record(value, 'Catalog item');
    text(item.id, 'Item id');
    text(item.title, 'Item title');
    text(item.url, 'Package path');
    if (ids.has(item.id)) throw new Error('Catalog item ids must be unique.');
    ids.add(item.id);
    if (
      !valid(item.version) ||
      !['pad', 'behaviorTree', 'workspace', 'collection'].includes(item.kind) ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error(`Invalid version, kind or SHA-256 for ${item.id}.`);
    if (
      item.kinds !== undefined &&
      (!Array.isArray(item.kinds) || item.kinds.some(kind => !['pad', 'behaviorTree', 'workspace'].includes(kind)))
    )
      throw new Error('Invalid catalog kinds.');
    if (item.description !== undefined && typeof item.description !== 'string')
      throw new Error('Invalid catalog description.');
    if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')))
      throw new Error('Invalid catalog tags.');
    return {
      id: item.id,
      title: item.title,
      version: item.version,
      kind: item.kind,
      url: item.url,
      sha256: item.sha256,
      description: item.description,
      kinds: item.kinds,
      tags: item.tags,
    } as CatalogItem;
  });
  return { schemaVersion: 1, title: raw.title, items };
}
export async function fetchContent(url: string, signal?: AbortSignal): Promise<string> {
  const target = catalogUrl(url);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(cancel, 12000);
  try {
    const response = await fetch(target, {
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Catalog download failed (HTTP ${response.status}).`);
    if (Number(response.headers.get('content-length')) > MAX_CONTENT_BYTES) throw new Error('Download exceeds 5 MiB.');
    if (!response.body) {
      const source = await response.text();
      parseContentJson(source);
      return source;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0,
      source = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CONTENT_BYTES) throw new Error('Download exceeds 5 MiB.');
        source += decoder.decode(value, { stream: true });
      }
      source += decoder.decode();
      return source;
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (controller.signal.aborted) throw new Error('Catalog download timed out. Cached content is still available.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
export function checkedRelease(source: string, item: CatalogItem): CachedRelease {
  if (contentHash(source) !== item.sha256)
    throw new Error(`SHA-256 does not match ${item.title}. Nothing was imported.`);
  const pack = readLibraryPackage(source, item.title);
  const raw = record(parseContentJson(source), 'Package');
  if (raw.schemaVersion !== undefined && (pack.id !== item.id || pack.version !== item.version))
    throw new Error('Package identity/version does not match its catalog entry.');
  if (item.kind !== 'collection' && !pack.documents.some(doc => doc.kind === item.kind))
    throw new Error('Package kind does not match its catalog entry.');
  return { sha256: item.sha256, source, package: pack };
}
export async function downloadRelease(
  source: LibrarySource,
  item: CatalogItem,
  signal?: AbortSignal
): Promise<CachedRelease> {
  if (!source.url) throw new Error('Reselect this folder to refresh its files.');
  return checkedRelease(await fetchContent(new URL(item.url, source.url).href, signal), item);
}
/** A cache hit must satisfy the current entry's identity/kind as well as its byte hash. */
export async function resolveRelease(
  source: LibrarySource,
  item: CatalogItem,
  cached: CachedRelease | undefined,
  signal?: AbortSignal
): Promise<CachedRelease> {
  return cached ? checkedRelease(cached.source, item) : downloadRelease(source, item, signal);
}
const safePath = (value: string) => {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some(part => !part || part === '.' || part === '..') ||
    /^[a-z]+:/i.test(value)
  )
    throw new Error('Catalog paths must stay inside the selected folder.');
  return value;
};
export interface FolderImport {
  source: LibrarySource;
  releases: CachedRelease[];
  skipped: number;
}
/** The picker grants a snapshot, not ongoing access to arbitrary host directories. */
export async function readLibraryFolder(
  files: File[],
  signal?: AbortSignal,
  existingId?: string
): Promise<FolderImport> {
  if (files.length > 3000)
    throw new Error('Choose the robot library folder rather than an entire build/workspace (maximum 3000 files).');
  const json = files
    .filter(file => file.name.toLowerCase().endsWith('.json'))
    .sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));
  if (json.length > 200 || json.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024)
    throw new Error('Folder JSON allowance exceeded (200 files / 32 MiB).');
  if (!json.length) throw new Error('This folder contains no JSON content.');
  const paths = new Map<string, File>();
  for (const file of json) {
    const path = safePath(file.webkitRelativePath || file.name);
    if (paths.has(path)) throw new Error('Duplicate folder path.');
    paths.set(path, file);
  }
  const manifest = [...paths]
    .sort(([a], [b]) => a.split('/').length - b.split('/').length)
    .find(([path]) => /(^|\/)(roboboy-library|catalog)\.json$/.test(path));
  let catalog: Catalog;
  const releases: CachedRelease[] = [];
  let skipped = 0;
  if (manifest) {
    catalog = readCatalog(await readContentFile(manifest[1], signal));
    const prefix = manifest[0].slice(0, manifest[0].lastIndexOf('/') + 1);
    for (const item of catalog.items) {
      const file = paths.get(prefix + safePath(item.url));
      if (!file) throw new Error(`Missing ${item.url} in the selected folder.`);
      releases.push(checkedRelease(await readContentFile(file, signal), item));
    }
    skipped = json.length - releases.length - 1;
  } else {
    const packages: Array<{ pack: LibraryPackage; path: string }> = [];
    const parsed: Array<{ path: string; raw: Record<string, any>; file: File }> = [];
    for (const [path, file] of paths) {
      const raw = parseContentJson(await readContentFile(file, signal));
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        !(
          'entryDocument' in raw ||
          'documents' in raw ||
          'layouts' in raw ||
          'tree' in raw ||
          'currentWorkspace' in raw
        )
      ) {
        skipped++;
        continue;
      }
      parsed.push({ path, raw: raw as Record<string, any>, file });
    }
    const pads = parsed.flatMap(({ raw }) =>
      Array.isArray(raw.layouts) && raw.layouts.every((item: any) => Array.isArray(item.components)) ? raw.layouts : []
    );
    for (const { path, raw, file } of parsed) {
      // Old robot folders often keep Pad exports alongside workspace exports.
      // Include only the referenced definitions, rejecting ambiguous ids rather than choosing a file by order.
      if (
        !raw.schemaVersion &&
        (raw.currentWorkspace || raw.layouts?.some((item: any) => Array.isArray(item.panels)))
      ) {
        const embedded = raw.gamepads ?? [];
        if (!Array.isArray(embedded)) throw new Error('Invalid workspace Pads.');
        const needed = new Set(
          [raw.currentWorkspace, ...(raw.layouts ?? [])]
            .filter(Boolean)
            .flatMap((layout: any) =>
              (layout.panels ?? [])
                .filter((panel: any) => panel.type === 'pad' && panel.layoutId)
                .map((panel: any) => panel.layoutId)
            )
        );
        const extra = [...needed]
          .filter(id => !embedded.some((pad: any) => pad.id === id))
          .map(id => {
            const matches = pads.filter((pad: any) => pad.id === id);
            if (matches.length !== 1)
              throw new Error(`Missing or ambiguous Pad ${id} in ${path}. Export a complete workspace bundle.`);
            return matches[0];
          });
        raw.gamepads = [...embedded, ...extra];
      }
      packages.push({ pack: readLibraryPackage(JSON.stringify(raw), file.name.replace(/\.json$/i, '')), path });
    }
    if (!packages.length)
      throw new Error(
        'No supported Robo-Boy content found. Include a roboboy-library.json catalog or exported Pad/BT/workspace JSON files.'
      );
    catalog = {
      schemaVersion: 1,
      title: files[0]?.webkitRelativePath.split('/')[0] || 'Local folder',
      items: packages.map(({ pack, path }) => {
        const id = `folder.${contentHash(path).slice(0, 24)}`;
        // Standalone exports become separate collections; a catalog can group them into robot packages.
        const source = JSON.stringify(validateLibraryPackage({ ...pack, id }));
        const hash = contentHash(source);
        releases.push({ sha256: hash, source, package: { ...pack, id } });
        return {
          id,
          title: pack.title,
          kind: pack.documents.length > 1 ? 'collection' : pack.documents[0].kind,
          kinds: [...new Set(pack.documents.map(doc => doc.kind))],
          version: pack.version,
          url: path,
          sha256: hash,
        };
      }),
    };
  }
  return {
    source: { id: existingId ?? createUuid(), title: catalog.title, type: 'folder', catalog, updatedAt: Date.now() },
    releases,
    skipped,
  };
}
