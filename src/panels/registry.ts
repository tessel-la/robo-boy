import { satisfies, valid, validRange } from 'semver';
import { version as roboBoyVersion } from '../../package.json';
import { BUILT_IN_PANELS } from './builtInPanels';
import { DEFAULT_INSTALLED_PANEL_REGISTRY_PATH, ROBOBOY_PANEL_API_VERSION } from './constants';
import type {
  InstalledPanelRegistryResult,
  PanelRegistryIssue,
  ResolvedPanelManifest,
  RoboBoyPanelCapability,
  RoboBoyPanelManifest,
} from './types';

const PANEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const PANEL_CAPABILITIES = new Set<RoboBoyPanelCapability>([
  'ros',
  'storage',
  'network',
  'web-bluetooth',
  'web-usb',
  'web-serial',
  'camera',
  'microphone',
]);

interface ParseRegistryOptions {
  hostVersion?: string;
  panelApiVersion?: string;
  existingIds?: Iterable<string>;
}

interface InstalledPanelRegistryDocument {
  schemaVersion: 1;
  panels: unknown[];
}

export const isValidPanelId = (value: unknown): value is string => {
  return typeof value === 'string' && value.length <= 128 && PANEL_ID_PATTERN.test(value);
};

const isNonEmptyString = (value: unknown, maxLength = 500): value is string => {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
};

const isHttpUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const isStringArray = (value: unknown, maxItems = 30): value is string[] => {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => isNonEmptyString(item, 80));
};

const isManifestShape = (value: unknown): value is RoboBoyPanelManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RoboBoyPanelManifest>;
  const compatibility = candidate.compatibility;
  const author = candidate.author;
  const capabilities = candidate.capabilities;

  return (
    candidate.schemaVersion === 1 &&
    isValidPanelId(candidate.id) &&
    isNonEmptyString(candidate.name, 120) &&
    isNonEmptyString(candidate.description, 1000) &&
    typeof candidate.version === 'string' &&
    Boolean(valid(candidate.version)) &&
    isNonEmptyString(candidate.entryPoint, 2048) &&
    Boolean(
      compatibility &&
      typeof compatibility === 'object' &&
      typeof compatibility.panelApi === 'string' &&
      validRange(compatibility.panelApi) &&
      typeof compatibility.roboboy === 'string' &&
      validRange(compatibility.roboboy)
    ) &&
    Boolean(author && typeof author === 'object' && isNonEmptyString(author.name, 120)) &&
    (!author?.url || isHttpUrl(author.url)) &&
    isHttpUrl(candidate.repository) &&
    (!capabilities ||
      (Array.isArray(capabilities) &&
        new Set(capabilities).size === capabilities.length &&
        capabilities.every(capability => PANEL_CAPABILITIES.has(capability)))) &&
    (!candidate.tags || isStringArray(candidate.tags)) &&
    (!candidate.icon || isNonEmptyString(candidate.icon, 2048)) &&
    (!candidate.preview || isNonEmptyString(candidate.preview, 2048))
  );
};

const resolveSameOriginEntryPoint = (entryPoint: string, registryUrl: string): string | null => {
  try {
    const registry = new URL(registryUrl);
    const resolved = new URL(entryPoint, registry);
    const isSameLocation = resolved.protocol === registry.protocol && resolved.host === registry.host;
    const isLoadableProtocol = ['http:', 'https:', 'tauri:', 'asset:', 'customprotocol:'].includes(resolved.protocol);
    return isSameLocation && isLoadableProtocol ? resolved.href : null;
  } catch {
    return null;
  }
};

export const parseInstalledPanelRegistry = (
  value: unknown,
  registryUrl: string,
  options: ParseRegistryOptions = {}
): InstalledPanelRegistryResult => {
  const issues: PanelRegistryIssue[] = [];
  const panels: ResolvedPanelManifest[] = [];
  const hostVersion = options.hostVersion || roboBoyVersion;
  const panelApiVersion = options.panelApiVersion || ROBOBOY_PANEL_API_VERSION;
  const knownIds = new Set(options.existingIds || BUILT_IN_PANELS.map(panel => panel.id));

  if (!value || typeof value !== 'object' || (value as Partial<InstalledPanelRegistryDocument>).schemaVersion !== 1) {
    return {
      panels,
      issues: [{ code: 'invalid-registry', message: 'The installed panel registry must use schemaVersion 1.' }],
    };
  }

  const document = value as Partial<InstalledPanelRegistryDocument>;
  if (!Array.isArray(document.panels)) {
    return {
      panels,
      issues: [{ code: 'invalid-registry', message: 'The installed panel registry must contain a panels array.' }],
    };
  }

  document.panels.forEach((candidate, index) => {
    const candidateId = candidate && typeof candidate === 'object' ? (candidate as { id?: unknown }).id : undefined;
    const panelId = typeof candidateId === 'string' ? candidateId : undefined;
    if (!isManifestShape(candidate)) {
      issues.push({
        code: 'invalid-manifest',
        panelId,
        message: `Installed panel entry ${index + 1}${panelId ? ` (${panelId})` : ''} has invalid metadata.`,
      });
      return;
    }

    if (knownIds.has(candidate.id)) {
      issues.push({
        code: 'duplicate-id',
        panelId: candidate.id,
        message: `Panel ID ${candidate.id} is already registered; the later entry was ignored.`,
      });
      return;
    }

    if (!satisfies(panelApiVersion, candidate.compatibility.panelApi, { includePrerelease: true })) {
      issues.push({
        code: 'incompatible-panel-api',
        panelId: candidate.id,
        message: `${candidate.name} requires panel API ${candidate.compatibility.panelApi}; Robo-Boy provides ${panelApiVersion}.`,
      });
      knownIds.add(candidate.id);
      return;
    }

    if (!satisfies(hostVersion, candidate.compatibility.roboboy, { includePrerelease: true })) {
      issues.push({
        code: 'incompatible-roboboy',
        panelId: candidate.id,
        message: `${candidate.name} supports Robo-Boy ${candidate.compatibility.roboboy}; this build is ${hostVersion}.`,
      });
      knownIds.add(candidate.id);
      return;
    }

    const entryPoint = resolveSameOriginEntryPoint(candidate.entryPoint, registryUrl);
    if (!entryPoint) {
      issues.push({
        code: 'invalid-entry-point',
        panelId: candidate.id,
        message: `${candidate.name} must use a same-origin installed entry point.`,
      });
      knownIds.add(candidate.id);
      return;
    }

    knownIds.add(candidate.id);
    panels.push({ ...candidate, entryPoint, registryUrl });
  });

  return { panels, issues };
};

export const getInstalledPanelRegistryUrl = (): string => {
  const configuredPath = import.meta.env.VITE_PANEL_REGISTRY_URL?.trim();
  return new URL(configuredPath || DEFAULT_INSTALLED_PANEL_REGISTRY_PATH, document.baseURI).href;
};

export const loadInstalledPanelRegistry = async (
  registryUrl = getInstalledPanelRegistryUrl(),
  fetcher: typeof fetch = fetch
): Promise<InstalledPanelRegistryResult> => {
  try {
    const response = await fetcher(registryUrl, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseInstalledPanelRegistry(await response.json(), registryUrl);
  } catch (error) {
    return {
      panels: [],
      issues: [
        {
          code: 'registry-unavailable',
          message: `Installed external panels could not be discovered: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
};
