import { loadVerifiedExternalPanelSource } from './loader';
import { seedLocalPanelsFromBundle } from './localPanelSeed';
import {
  BUNDLED_PANEL_REGISTRY_PATH,
  BUNDLED_PANEL_REGISTRY_URL,
  LOCAL_PANEL_ORIGIN,
  LOCAL_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_URL,
  createIndexedDbPanelStore,
  createLocalPanelFetcher,
} from './localPanelStore';
import { loadInstalledPanelRegistry } from './registry';
import type { InstalledPanelRegistryResult, ResolvedPanelManifest } from './types';

/** The desktop shell's own panel storage. Lazy: nothing opens IndexedDB until it is first used. */
export const localPanelStore = createIndexedDbPanelStore();

export const localPanelFetcher = createLocalPanelFetcher(localPanelStore);

const isLocallyInstalled = (manifest: ResolvedPanelManifest) =>
  manifest.entryPoint.startsWith(`${LOCAL_PANEL_ORIGIN}/`);

/**
 * Picks the transport from where the panel was installed rather than from the runtime, so a
 * locally installed panel and a deployment-served one are verified by exactly the same code.
 */
export const loadExternalPanelSource = (manifest: ResolvedPanelManifest): Promise<string> =>
  loadVerifiedExternalPanelSource(manifest, isLocallyInstalled(manifest) ? localPanelFetcher : fetch);

let seeding: Promise<string[]> | null = null;

/** Runs the one-time bundled-panel seed, at most once per session. */
export const ensureLocalPanelsSeeded = (): Promise<string[]> =>
  (seeding ??= seedLocalPanelsFromBundle(localPanelStore).catch(error => {
    console.warn(`[external panels] ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }));

const EMPTY_RESULT: InstalledPanelRegistryResult = { panels: [], issues: [] };

const readRegistry = async (path: string, url: string): Promise<InstalledPanelRegistryResult> =>
  (await localPanelStore.read(path)) === null ? EMPTY_RESULT : loadInstalledPanelRegistry(url, localPanelFetcher);

/**
 * Everything this shell can run: the panels its build shipped, plus the ones installed through
 * the manager. An installed panel takes precedence over a bundled one with the same ID, since the
 * user asked for that version explicitly.
 */
export interface LocalPanelRegistries extends InstalledPanelRegistryResult {
  /** Only the panels the manager owns; bundled panels are not part of its desired state. */
  managed: ResolvedPanelManifest[];
}

export const loadLocalPanelRegistry = async (): Promise<LocalPanelRegistries> => {
  await ensureLocalPanelsSeeded();
  const [bundled, installed] = await Promise.all([
    readRegistry(BUNDLED_PANEL_REGISTRY_PATH, BUNDLED_PANEL_REGISTRY_URL),
    readRegistry(LOCAL_PANEL_REGISTRY_PATH, LOCAL_PANEL_REGISTRY_URL),
  ]);

  const byId = new Map(bundled.panels.map(panel => [panel.id, panel]));
  for (const panel of installed.panels) byId.set(panel.id, panel);

  return {
    panels: [...byId.values()],
    issues: [...bundled.issues, ...installed.issues],
    managed: installed.panels,
  };
};
