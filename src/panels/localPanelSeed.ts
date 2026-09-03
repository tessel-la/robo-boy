import {
  BUNDLED_PANEL_PREFIX,
  BUNDLED_PANEL_REGISTRY_PATH,
  BUNDLED_PANEL_REGISTRY_URL,
  type LocalPanelStore,
} from './localPanelStore';
import { parseInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

/** Where a build that bundles panels ships its registry, as an ordinary app asset. */
const BUNDLED_REGISTRY_ASSET = 'panels/installed.json';

export class PanelSeedError extends Error {}

/**
 * Copies the panels a build ships into the store's bundled namespace.
 *
 * Desktop reads only what its store holds, so a build that ships panels has to hand them over or
 * they would never be visible. They are kept apart from panels installed through the manager: the
 * manager's desired state describes external panels only, and must not decide the fate of panels
 * that came with the build.
 *
 * The seed mirrors the build on every run -- adding what is new, dropping what the build no longer
 * ships -- so bundled panels are always exactly what was installed, and a build's panels cannot be
 * lost. Bundled bytes are verified against the manifest exactly like a remote install.
 */
export const seedLocalPanelsFromBundle = async (
  store: LocalPanelStore,
  fetcher: typeof fetch = fetch,
  baseUrl: string = document.baseURI
): Promise<string[]> => {
  const registryUrl = new URL(BUNDLED_REGISTRY_ASSET, baseUrl).href;
  let bundled: { panels?: unknown };
  try {
    const response = await fetcher(registryUrl, { cache: 'no-cache' });
    if (!response.ok) return await clearBundled(store);
    bundled = JSON.parse(await response.text());
  } catch {
    // A build without bundled panels has no such asset; leave the store untouched.
    return [];
  }

  const candidates = Array.isArray(bundled?.panels) ? (bundled.panels as Record<string, unknown>[]) : [];
  if (candidates.length === 0) return await clearBundled(store);

  const bundles = new Map<string, string>();
  const manifests: Record<string, unknown>[] = [];

  for (const manifest of candidates) {
    const path = `${BUNDLED_PANEL_PREFIX}${manifest.id}/${manifest.version}/index.js`;
    const existing = await store.read(path);
    const source =
      existing ??
      (await (async () => {
        const response = await fetcher(new URL(String(manifest.entryPoint), registryUrl).href, { cache: 'no-cache' });
        if (!response.ok) {
          throw new PanelSeedError(`${manifest.id} is listed by this build but its bundle is missing.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if ((await getSha256Integrity(bytes)) !== manifest.integrity) {
          throw new PanelSeedError(`${manifest.id} failed integrity verification and was not installed.`);
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      })());

    bundles.set(path, source);
    manifests.push({ ...manifest, entryPoint: `./${path}` });
  }

  const registry = { schemaVersion: 1, panels: manifests };
  const parsed = parseInstalledPanelRegistry(registry, BUNDLED_PANEL_REGISTRY_URL);
  if (parsed.issues.length > 0) throw new PanelSeedError(parsed.issues.map(issue => issue.message).join(' '));

  for (const [path, contents] of bundles) await store.write(path, contents);
  await store.write(BUNDLED_PANEL_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  for (const path of await store.list()) {
    if (path.startsWith(BUNDLED_PANEL_PREFIX) && !bundles.has(path)) await store.remove(path);
  }

  return parsed.panels.map(panel => panel.id);
};

/** Drops the bundled namespace when the current build ships no panels. */
const clearBundled = async (store: LocalPanelStore): Promise<string[]> => {
  for (const path of await store.list()) {
    if (path.startsWith(BUNDLED_PANEL_PREFIX) || path === BUNDLED_PANEL_REGISTRY_PATH) await store.remove(path);
  }
  return [];
};
