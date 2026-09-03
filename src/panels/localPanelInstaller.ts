import {
  BUNDLED_PANEL_PREFIX,
  BUNDLED_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_URL,
  type LocalPanelStore,
} from './localPanelStore';
import { parseInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

const MAX_JSON_BYTES = 512 * 1024;
const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
const MAX_PANELS = 100;

export interface RemotePanelSource {
  name: string;
  catalogUrl: string;
  allowedOrigins?: string[];
}

export interface LocalPanelSelection {
  mode: 'all' | 'include';
  panelIds?: string[];
}

export class LocalInstallError extends Error {}

export interface CatalogPanelSummary {
  id: string;
  name: string;
  description: string;
  version: string;
}

const bundlePath = (id: string, version: string) => `${id}/${version}/index.js`;

const readBounded = async (response: Response, limit: number, label: string): Promise<Uint8Array> => {
  if (!response.ok) throw new LocalInstallError(`${label} could not be downloaded (HTTP ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new LocalInstallError(`${label} exceeds ${limit} bytes.`);
  return bytes;
};

/** Resolves a URL and refuses anything the source has not explicitly allow-listed. */
const resolveAllowed = (value: string, base: URL, allowed: Set<string>, label: string): URL => {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new LocalInstallError(`${label} is not a valid URL.`);
  }
  if (url.protocol !== 'https:') throw new LocalInstallError(`${label} must use HTTPS.`);
  if (!allowed.has(url.origin)) throw new LocalInstallError(`${label} uses unapproved origin ${url.origin}.`);
  return url;
};

/**
 * Installs panels into the desktop shell's own storage. The packaged app has no reverse proxy to
 * run the server-side installer behind, so it performs the same fetch-and-verify work here and
 * hands the result to the existing registry parser before anything is written.
 */
interface CollectedPanel {
  manifest: Record<string, unknown>;
  bundle?: string;
}

/**
 * Walks a remote catalog once. `withBundles` is what separates browsing from installing: listing
 * never downloads bundle bytes, so opening the manager stays cheap.
 */
const collectCatalog = async (
  source: RemotePanelSource,
  selection: LocalPanelSelection,
  withBundles: boolean,
  fetcher: typeof fetch
): Promise<CollectedPanel[]> => {
  const catalogUrl = new URL(source.catalogUrl);
  const allowed = new Set([catalogUrl.origin, ...(source.allowedOrigins ?? [])].map(origin => new URL(origin).origin));

  const catalog = await readJson(fetcher, catalogUrl, allowed, `${source.name} catalog`, catalogUrl);
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.panels)) {
    throw new LocalInstallError(`${source.name} catalog is invalid.`);
  }
  if (catalog.panels.length > MAX_PANELS) throw new LocalInstallError(`${source.name} catalog lists too many panels.`);

  const wanted = selection.mode === 'include' ? new Set(selection.panelIds ?? []) : null;
  const collected: CollectedPanel[] = [];

  for (const entryPath of catalog.panels) {
    if (typeof entryPath !== 'string') throw new LocalInstallError(`${source.name} catalog has an invalid entry.`);
    const entry = await readJson(fetcher, entryPath, allowed, `${source.name} catalog entry`, catalogUrl);
    if (entry?.schemaVersion !== 1 || typeof entry.id !== 'string') {
      throw new LocalInstallError(`${source.name} catalog entry is invalid.`);
    }
    if (wanted && !wanted.has(entry.id)) continue;

    const distribution = (entry.latest as Record<string, unknown> | undefined)?.distribution as
      | Record<string, string>
      | undefined;
    if (distribution?.type !== 'javascript-bundle') {
      throw new LocalInstallError(`${entry.id} has an unsupported distribution.`);
    }

    const manifest = await readJson(fetcher, distribution.manifestUrl, allowed, `${entry.id} manifest`, catalogUrl);
    if (manifest?.id !== entry.id) throw new LocalInstallError(`${entry.id} manifest does not match its catalog entry.`);
    if (!withBundles) {
      collected.push({ manifest });
      continue;
    }
    if (Array.isArray(manifest.assets) && manifest.assets.length > 0) {
      throw new LocalInstallError(`${entry.id} ships additional assets, which desktop installs do not support yet.`);
    }

    const bundleUrl = resolveAllowed(distribution.bundleUrl, catalogUrl, allowed, `${entry.id} bundleUrl`);
    const bundle = await readBounded(
      await fetcher(bundleUrl.href, { cache: 'no-cache' }),
      MAX_BUNDLE_BYTES,
      `${entry.id} bundle`
    );
    const integrity = await getSha256Integrity(bundle);
    if (integrity !== manifest.integrity || integrity !== distribution.integrity) {
      throw new LocalInstallError(`${entry.id} failed integrity verification and was not installed.`);
    }
    collected.push({ manifest, bundle: new TextDecoder('utf-8', { fatal: true }).decode(bundle) });
  }

  return collected;
};

const readJson = async (
  fetcher: typeof fetch,
  value: string | URL,
  allowed: Set<string>,
  label: string,
  base: URL
): Promise<Record<string, any>> => {
  const url = value instanceof URL ? value : resolveAllowed(value, base, allowed, label);
  const bytes = await readBounded(await fetcher(url.href, { cache: 'no-cache' }), MAX_JSON_BYTES, label);
  return JSON.parse(new TextDecoder().decode(bytes));
};

/** Panels a source offers, as metadata only. */
export const listLocalCatalog = async (
  source: RemotePanelSource,
  fetcher: typeof fetch = fetch
): Promise<CatalogPanelSummary[]> =>
  (await collectCatalog(source, { mode: 'all' }, false, fetcher)).map(({ manifest }) => ({
    id: String(manifest.id),
    name: String(manifest.name),
    description: String(manifest.description),
    version: String(manifest.version),
  }));

/** Manifests a desired state resolves to, without downloading or installing anything. */
export const previewLocalPanels = async (
  { source, selection }: { source: RemotePanelSource; selection: LocalPanelSelection },
  fetcher: typeof fetch = fetch
): Promise<Record<string, unknown>[]> =>
  (await collectCatalog(source, selection, false, fetcher)).map(({ manifest }) => manifest);

/**
 * Installs panels into the desktop shell's own storage. The packaged app has no reverse proxy to
 * run the server-side installer behind, so it performs the same fetch-and-verify work here and
 * hands the result to the existing registry parser before anything is written.
 */
export const installLocalPanels = async (
  { source, selection }: { source: RemotePanelSource; selection: LocalPanelSelection },
  store: LocalPanelStore,
  fetcher: typeof fetch = fetch
): Promise<{ installed: string[] }> => {
  const collected = await collectCatalog(source, selection, true, fetcher);
  const bundles = new Map<string, string>();
  const manifests = collected.map(({ manifest, bundle }) => {
    const path = bundlePath(String(manifest.id), String(manifest.version));
    bundles.set(path, bundle!);
    return { ...manifest, entryPoint: `./${path}` };
  });

  const registry = { schemaVersion: 1, panels: manifests };
  // Refuse to install anything the runtime would later reject.
  const parsed = parseInstalledPanelRegistry(registry, LOCAL_PANEL_REGISTRY_URL);
  if (parsed.issues.length > 0) {
    throw new LocalInstallError(parsed.issues.map(issue => issue.message).join(' '));
  }

  for (const [path, contents] of bundles) await store.write(path, contents);
  await store.write(LOCAL_PANEL_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

  // A plan describes externally installed panels only. Panels that came with the build, and the
  // stored configuration, are outside its scope and must survive it.
  for (const path of await store.list()) {
    if (bundles.has(path) || !path.endsWith('/index.js')) continue;
    if (path.startsWith(BUNDLED_PANEL_PREFIX) || path === BUNDLED_PANEL_REGISTRY_PATH) continue;
    await store.remove(path);
  }

  return { installed: parsed.panels.map(panel => panel.id) };
};
