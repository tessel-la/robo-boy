import { OFFICIAL_PANEL_SOURCE } from './constants';
import {
  LocalInstallError,
  installLocalPanels,
  listLocalCatalog,
  previewLocalPanels,
  type LocalPanelSelection,
  type RemotePanelSource,
} from './localPanelInstaller';
import { LOCAL_PANEL_REGISTRY_URL, createLocalPanelFetcher, type LocalPanelStore } from './localPanelStore';
import { localPanelStore } from './localPanels';
import {
  applyPanelManagerPlan,
  fetchPanelManagerStatus,
  listPanelCatalog,
  loadPanelManagerConfig,
  previewPanelManagerConfig,
  type CatalogPanelSummary,
  type PanelInstallChange,
  type PanelInstallPreview,
  type PanelSourcesConfig,
  type RemotePanelSourceConfig,
} from './managerApi';
import { panelInstallFetch } from './panelInstallFetch';
import { loadInstalledPanelRegistry } from './registry';
import type { RoboBoyPanelManifest } from './types';

/**
 * How the manager dialog reaches panel installation. The web app drives the deployment's manager
 * service; the desktop shell has no such service and installs into its own storage instead.
 */
export interface PanelManagerBackend {
  /**
   * Whether this backend authenticates at all. A deployment only demands a token when it was
   * configured with one, and desktop installs are local, so there is nothing to authenticate
   * against; asking avoids putting a token prompt in front of users who need no token.
   */
  requiresToken(): Promise<boolean>;
  loadConfig(token: string): Promise<{ config: PanelSourcesConfig; startupError?: string }>;
  listCatalog(token: string, source: RemotePanelSourceConfig): Promise<{ panels: CatalogPanelSummary[] }>;
  preview(token: string, config: PanelSourcesConfig): Promise<PanelInstallPreview>;
  apply(token: string, planId: string): Promise<{ installed: number }>;
}

export const remotePanelManagerBackend: PanelManagerBackend = {
  requiresToken: async () => {
    try {
      return (await fetchPanelManagerStatus()).authenticationRequired;
    } catch {
      // Unreachable manager: let the real request report why, rather than demanding a token.
      return false;
    }
  },
  loadConfig: token => loadPanelManagerConfig(token),
  listCatalog: (token, source) => listPanelCatalog(token, source.name),
  preview: (token, config) => previewPanelManagerConfig(token, config),
  apply: (token, planId) => applyPanelManagerPlan(token, planId),
};

const CONFIG_PATH = 'panel-sources.json';

const DEFAULT_CONFIG: PanelSourcesConfig = {
  schemaVersion: 2,
  sources: [OFFICIAL_PANEL_SOURCE],
  selection: { mode: 'include', panelIds: [] },
};

const firstRemoteSource = (config: PanelSourcesConfig): RemotePanelSource => {
  const source = config.sources.find((candidate): candidate is RemotePanelSourceConfig => candidate.type === 'remote');
  if (!source) {
    throw new LocalInstallError('Desktop panel installation needs a remote source; local directories are unavailable.');
  }
  return { name: source.name, catalogUrl: source.catalogUrl, allowedOrigins: source.allowedOrigins };
};

const selectionOf = (config: PanelSourcesConfig): LocalPanelSelection =>
  config.selection.mode === 'include'
    ? { mode: 'include', panelIds: config.selection.panelIds }
    : { mode: config.selection.mode === 'all' ? 'all' : 'include', panelIds: [] };

export const createLocalPanelManagerBackend = (
  store: LocalPanelStore = localPanelStore,
  fetcher: typeof fetch = panelInstallFetch
): PanelManagerBackend => {
  const plans = new Map<string, PanelSourcesConfig>();
  // Must read back through the same store this backend writes to, not the module singleton.
  const installedFetcher = createLocalPanelFetcher(store);

  return {
    requiresToken: async () => false,

    async loadConfig() {
      const stored = await store.read(CONFIG_PATH);
      return { config: stored ? (JSON.parse(stored) as PanelSourcesConfig) : DEFAULT_CONFIG };
    },

    async listCatalog(_token, source) {
      return { panels: await listLocalCatalog(source, fetcher) };
    },

    async preview(_token, config) {
      const desired = { source: firstRemoteSource(config), selection: selectionOf(config) };
      const panels = (await previewLocalPanels(desired, fetcher)) as unknown as RoboBoyPanelManifest[];
      const installed = await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, installedFetcher);
      const installedVersions = new Map(installed.panels.map(panel => [panel.id, panel.version]));
      const desiredIds = new Set(panels.map(panel => panel.id));

      const changes: PanelInstallChange[] = [];
      for (const panel of panels) {
        const previousVersion = installedVersions.get(panel.id);
        if (previousVersion === undefined) changes.push({ type: 'add', panel });
        else if (previousVersion !== panel.version) changes.push({ type: 'update', panel, previousVersion });
      }
      for (const panel of installed.panels) {
        if (!desiredIds.has(panel.id)) changes.push({ type: 'remove', panel });
      }

      const planId = crypto.randomUUID();
      plans.set(planId, config);
      return { planId, expiresInSeconds: 600, panels, changes };
    },

    async apply(_token, planId) {
      const config = plans.get(planId);
      if (!config) throw new LocalInstallError('This preview expired. Preview the changes again before applying.');
      const desired = { source: firstRemoteSource(config), selection: selectionOf(config) };
      const { installed } = await installLocalPanels(desired, store, fetcher);
      // Written after the install, which prunes anything outside the new panel set.
      await store.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
      plans.clear();
      return { installed: installed.length };
    },
  };
};
