import { loadVerifiedExternalPanelSource } from './loader';
import { LOCAL_PANEL_ORIGIN, createIndexedDbPanelStore, createLocalPanelFetcher } from './localPanelStore';
import type { ResolvedPanelManifest } from './types';

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
