import type {
  RoboBoyJsonObject,
  RoboBoyPanelCapability,
  RoboBoyPanelDefinition,
  RoboBoyPanelManifest,
  RoboBoyPanelModule,
} from '../../panel-sdk';

export type {
  RoboBoyJsonObject,
  RoboBoyJsonValue,
  RoboBoyPanelCapability,
  RoboBoyPanelContext,
  RoboBoyPanelDefinition,
  RoboBoyPanelInstance,
  RoboBoyPanelLogger,
  RoboBoyPanelManifest,
  RoboBoyPanelModule,
  RoboBoyPanelStorage,
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
}

export type PanelModuleImporter = (entryPoint: string) => Promise<unknown>;

export const isPanelDefinition = (value: unknown): value is RoboBoyPanelDefinition => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RoboBoyPanelDefinition>;
  return (
    typeof candidate.apiVersion === 'string' &&
    typeof candidate.id === 'string' &&
    typeof candidate.activate === 'function'
  );
};

export const isPanelModule = (value: unknown): value is RoboBoyPanelModule => {
  return Boolean(
    value && typeof value === 'object' && isPanelDefinition((value as Partial<RoboBoyPanelModule>).default)
  );
};

export const isJsonObject = (value: unknown): value is RoboBoyJsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(item => isJsonValue(item));
};

export const isJsonValue = (value: unknown): boolean => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(item => isJsonValue(item));
  return isJsonObject(value);
};
