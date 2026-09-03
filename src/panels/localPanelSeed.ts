import { LOCAL_PANEL_REGISTRY_PATH, LOCAL_PANEL_REGISTRY_URL, type LocalPanelStore } from './localPanelStore';
import { parseInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

/** Where a build that bundles panels ships its registry, as an ordinary app asset. */
const BUNDLED_REGISTRY_PATH = 'panels/installed.json';

export class PanelSeedError extends Error {}

/**
 * Copies panels bundled into the app into its local store, once.
 *
 * Desktop reads only what it has installed, so a build that ships panels has to hand them over
 * on first run or they would never be visible. Builds without bundled panels have no such asset
 * and seed nothing. Anything the user installs later wins: this never overwrites an existing
 * store, and the bundled bytes are verified against the manifest exactly like a remote install.
 */
export const seedLocalPanelsFromBundle = async (
  store: LocalPanelStore,
  fetcher: typeof fetch = fetch,
  baseUrl: string = document.baseURI
): Promise<string[]> => {
  if (await store.read(LOCAL_PANEL_REGISTRY_PATH)) return [];

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

  for (const manifest of candidates) {
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

  const registry = { schemaVersion: 1, panels: manifests };
  const parsed = parseInstalledPanelRegistry(registry, LOCAL_PANEL_REGISTRY_URL);
  if (parsed.issues.length > 0) throw new PanelSeedError(parsed.issues.map(issue => issue.message).join(' '));

  for (const [path, contents] of bundles) await store.write(path, contents);
  await store.write(LOCAL_PANEL_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

  return parsed.panels.map(panel => panel.id);
};
