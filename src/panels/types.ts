import type {
  RoboBoyJsonObject,
  RoboBoyPanelCapability,
  RoboBoyPanelManifest,
  RoboBoyPanelRuntime,
} from '../../panel-sdk';

export type {
  RoboBoyJsonObject,
  RoboBoyJsonValue,
  RoboBoyPanelAsset,
  RoboBoyPanelCapability,
  RoboBoyPanelConnection,
  RoboBoyPanelConnectionSnapshot,
  RoboBoyPanelContext,
  RoboBoyPanelDefinition,
  RoboBoyPanelInstance,
  RoboBoyPanelLogger,
  RoboBoyPanelManifest,
  RoboBoyPanelModule,
  RoboBoyPanelNetwork,
  RoboBoyPanelNetworkPermissions,
  RoboBoyPanelPermissions,
  RoboBoyPanelRos,
  RoboBoyPanelRosPermissions,
  RoboBoyPanelRuntime,
  RoboBoyPanelStorage,
  RoboBoyPanelViewport,
  RoboBoyPanelViewportSnapshot,
  RoboBoyRosPublishOptions,
  RoboBoyRosServiceOptions,
  RoboBoyRosSubscription,
  RoboBoyRosSubscriptionOptions,
  RoboBoyRosTopic,
} from '../../panel-sdk';

export type BuiltInPanelId = 'camera' | '3d' | 'behaviorTree' | 'tfTree' | 'pad';

export interface BuiltInPanelCatalogEntry {
  id: BuiltInPanelId;
  name: string;
  menuLabel: string;
  description: string;
  version: string;
  capabilities: readonly RoboBoyPanelCapability[];
  icon: BuiltInPanelId;
  source: 'built-in';
}

export interface ExternalPanelCatalogEntry {
  id: string;
  name: string;
  menuLabel: string;
  description: string;
  version: string;
  capabilities: readonly RoboBoyPanelCapability[];
  icon: 'external';
  source: 'external';
  manifest: ResolvedPanelManifest;
}

export type PanelCatalogEntry = BuiltInPanelCatalogEntry | ExternalPanelCatalogEntry;

export interface ResolvedPanelManifest extends RoboBoyPanelManifest {
  entryPoint: string;
  registryUrl: string;
}

export type PanelRegistryIssueCode =
  | 'invalid-registry'
  | 'invalid-manifest'
  | 'duplicate-id'
  | 'incompatible-panel-api'
  | 'incompatible-roboboy'
  | 'invalid-entry-point'
  | 'registry-unavailable';

export interface PanelRegistryIssue {
  code: PanelRegistryIssueCode;
  message: string;
  panelId?: string;
}

export interface InstalledPanelRegistryResult {
  panels: ResolvedPanelManifest[];
  issues: PanelRegistryIssue[];
  installation?: PanelInstallationMetadata;
}

export interface PanelInstallationSource {
  type: 'remote' | 'local';
  name: string;
}

export interface PanelInstallationMetadata {
  schemaVersion: 1;
  configSchemaVersion: 2;
  selection: {
    mode: 'all' | 'include' | 'none';
    panelIds?: string[];
  };
  sources: PanelInstallationSource[];
  resolvedPanels: Array<{
    id: string;
    version: string;
    integrity: string;
    source: PanelInstallationSource;
  }>;
}

export interface PanelHostRuntime {
  target: RoboBoyPanelRuntime['target'];
  endpoints: {
    videoStream: string;
  };
}

export interface StoredPanelState {
  schemaVersion: 1;
  panelId: string;
  values: RoboBoyJsonObject;
}

const isJsonValueInternal = (value: unknown, ancestors: Set<object>, depth: number): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object' || depth > 20 || ancestors.has(value)) return false;

  ancestors.add(value);
  const isValid = Array.isArray(value)
    ? value.every(item => isJsonValueInternal(item, ancestors, depth + 1))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every(item => isJsonValueInternal(item, ancestors, depth + 1));
  ancestors.delete(value);
  return isValid;
};

export const isJsonObject = (value: unknown): value is RoboBoyJsonObject => {
  return (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isJsonValueInternal(value, new Set(), 0)
  );
};

export const isJsonValue = (value: unknown): boolean => isJsonValueInternal(value, new Set(), 0);

export const isStoredPanelState = (value: unknown, panelId?: string): value is StoredPanelState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredPanelState>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.panelId === 'string' &&
    (!panelId || candidate.panelId === panelId) &&
    isJsonObject(candidate.values)
  );
};
