import { LOCAL_PANEL_REGISTRY_PATH, LOCAL_PANEL_REGISTRY_URL, type LocalPanelStore } from './localPanelStore';
import { parseInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

/** Where a build that bundles panels ships its registry, as an ordinary app asset. */
const BUNDLED_REGISTRY_PATH = 'panels/installed.json';

/** Which bundled releases have already been offered, so removing one does not resurrect it. */
const SEED_MARKER_PATH = 'bundled-seed.json';

const releaseKey = (manifest: Record<string, unknown>) => `${manifest.id}@${manifest.version}`;

const readJsonFile = async (store: LocalPanelStore, path: string): Promise<unknown> => {
  const contents = await store.read(path);
  if (contents === null) return null;
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
};

export class PanelSeedError extends Error {}

/**
 * Copies panels bundled into the app into its local store, once.
 *
 * Desktop reads only what it has installed, so a build that ships panels has to hand them over
 * or they would never be visible. Builds without bundled panels have no such asset and seed
 * nothing. Bundled bytes are verified against the manifest exactly like a remote install.
 *
 * Existing installs are never touched: a bundled panel is added only when the store has no panel
 * with that ID, and each bundled release is offered once, so a panel the user removes stays
 * removed instead of coming back on the next launch.
 */
export const seedLocalPanelsFromBundle = async (
  store: LocalPanelStore,
  fetcher: typeof fetch = fetch,
  baseUrl: string = document.baseURI
): Promise<string[]> => {
  const installed = await readJsonFile(store, LOCAL_PANEL_REGISTRY_PATH);
  // Unreadable registry: leave it alone rather than risk replacing panels the user installed.
  if (installed === undefined) return [];
  const existing = Array.isArray((installed as { panels?: unknown })?.panels)
    ? ((installed as { panels: Record<string, unknown>[] }).panels)
    : [];
  const existingIds = new Set(existing.map(panel => String(panel.id)));

  const marker = await readJsonFile(store, SEED_MARKER_PATH);
  const offered = new Set(Array.isArray((marker as { seeded?: unknown })?.seeded)
    ? ((marker as { seeded: unknown[] }).seeded).map(String)
    : []);

  const registryUrl = new URL(BUNDLED_REGISTRY_PATH, baseUrl).href;
  let bundled: { panels?: unknown };
  try {
    const response = await fetcher(registryUrl, { cache: 'no-cache' });
    if (!response.ok) return [];
    bundled = JSON.parse(await response.text());
  } catch {
    return [];
  }

  const candidates = Array.isArray(bundled?.panels) ? (bundled.panels as Record<string, unknown>[]) : [];
  if (candidates.length === 0) return [];

  const bundles = new Map<string, string>();
  const manifests: Record<string, unknown>[] = [];

  const pending = candidates.filter(
    manifest => !offered.has(releaseKey(manifest)) && !existingIds.has(String(manifest.id))
  );
  const seedMarker = `${JSON.stringify({ seeded: [...offered, ...candidates.map(releaseKey)] }, null, 2)}\n`;
  if (pending.length === 0) {
    await store.write(SEED_MARKER_PATH, seedMarker);
    return [];
  }

  for (const manifest of pending) {
    const bundleUrl = new URL(String(manifest.entryPoint), registryUrl).href;
    const response = await fetcher(bundleUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new PanelSeedError(`${manifest.id} is listed by this build but its bundle is missing.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await getSha256Integrity(bytes)) !== manifest.integrity) {
      throw new PanelSeedError(`${manifest.id} failed integrity verification and was not installed.`);
    }
    const path = `${manifest.id}/${manifest.version}/index.js`;
    bundles.set(path, new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    manifests.push({ ...manifest, entryPoint: `./${path}` });
  }

  const registry = { schemaVersion: 1, panels: [...existing, ...manifests] };
  const parsed = parseInstalledPanelRegistry(registry, LOCAL_PANEL_REGISTRY_URL);
  if (parsed.issues.length > 0) throw new PanelSeedError(parsed.issues.map(issue => issue.message).join(' '));

  for (const [path, contents] of bundles) await store.write(path, contents);
  await store.write(LOCAL_PANEL_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  await store.write(SEED_MARKER_PATH, seedMarker);

  return manifests.map(manifest => String(manifest.id));
};
