import { satisfies, valid, validRange } from 'semver';
import { version as roboBoyVersion } from '../../package.json';
import { BUILT_IN_PANELS } from './builtInPanels';
import { DEFAULT_INSTALLED_PANEL_REGISTRY_PATH, ROBOBOY_PANEL_API_VERSION } from './constants';
import type {
  InstalledPanelRegistryResult,
  PanelInstallationMetadata,
  PanelRegistryIssue,
  ResolvedPanelManifest,
  RoboBoyPanelCapability,
  RoboBoyPanelManifest,
  RoboBoyPanelPermissions,
} from './types';

const PANEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
const PANEL_INTEGRITY_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const MAX_INSTALLED_PANELS = 100;
const MAX_REGISTRY_BYTES = 256 * 1024;
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
const HOST_ENDPOINTS = new Set(['videoStream', 'webrtcWhep', 'webrtcDiscovery']);
const ROS_RESOURCE_PATTERN = /^\/[A-Za-z0-9_~{}*][A-Za-z0-9_~{}/*-]*$/;

interface ParseRegistryOptions {
  hostVersion?: string;
  panelApiVersion?: string;
  existingIds?: Iterable<string>;
}

interface InstalledPanelRegistryDocument {
  schemaVersion: 1;
  panels: unknown[];
  installation?: unknown;
}

const parseInstallationMetadata = (value: unknown): PanelInstallationMetadata | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PanelInstallationMetadata>;
  const selection = candidate.selection;
  const sources = candidate.sources;
  const resolvedPanels = candidate.resolvedPanels;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.configSchemaVersion !== 2 ||
    !selection ||
    !['all', 'include', 'none'].includes(selection.mode) ||
    !Array.isArray(sources) ||
    !Array.isArray(resolvedPanels)
  ) {
    return undefined;
  }
  const validSource = (source: unknown): source is PanelInstallationMetadata['sources'][number] =>
    Boolean(
      source &&
      typeof source === 'object' &&
      ['remote', 'local'].includes((source as { type?: string }).type || '') &&
      isNonEmptyString((source as { name?: unknown }).name, 120)
    );
  if (sources.length > 20 || !sources.every(validSource)) return undefined;
  const sourceKeys = new Set(sources.map(source => `${source.type}:${source.name}`));
  if (sourceKeys.size !== sources.length) return undefined;
  if (
    selection.mode === 'include' &&
    (!Array.isArray(selection.panelIds) ||
      selection.panelIds.length === 0 ||
      new Set(selection.panelIds).size !== selection.panelIds.length ||
      !selection.panelIds.every(isValidPanelId))
  ) {
    return undefined;
  }
  if (selection.mode !== 'include' && selection.panelIds !== undefined) return undefined;
  if (
    resolvedPanels.length > 100 ||
    !resolvedPanels.every(panel => {
      if (!panel || typeof panel !== 'object') return false;
      const resolved = panel as PanelInstallationMetadata['resolvedPanels'][number];
      return (
        isValidPanelId(resolved.id) &&
        isNonEmptyString(resolved.version, 64) &&
        PANEL_INTEGRITY_PATTERN.test(resolved.integrity) &&
        validSource(resolved.source) &&
        sourceKeys.has(`${resolved.source.type}:${resolved.source.name}`)
      );
    })
  ) {
    return undefined;
  }
  if (new Set(resolvedPanels.map(panel => panel.id)).size !== resolvedPanels.length) return undefined;
  return candidate as PanelInstallationMetadata;
};

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

const isUniqueStringArray = (value: unknown, validator: (item: string) => boolean, maxItems = 100): value is string[] =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  new Set(value).size === value.length &&
  value.every(item => typeof item === 'string' && validator(item));

const isPanelPermissions = (
  value: unknown,
  capabilities: readonly RoboBoyPanelCapability[]
): value is RoboBoyPanelPermissions => {
  if (value === undefined) return !capabilities.includes('ros') && !capabilities.includes('network');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as RoboBoyPanelPermissions;
  const keys = Object.keys(candidate);
  if (keys.some(key => !['ros', 'network'].includes(key))) return false;

  if (capabilities.includes('ros')) {
    const ros = candidate.ros;
    if (!ros || typeof ros !== 'object' || Array.isArray(ros)) return false;
    if (Object.keys(ros).some(key => !['discover', 'selectTopic', 'subscribe', 'publish', 'services'].includes(key)))
      return false;
    if (ros.discover !== undefined && typeof ros.discover !== 'boolean') return false;
    if (ros.selectTopic !== undefined && typeof ros.selectTopic !== 'boolean') return false;
    if (
      !['subscribe', 'publish', 'services'].every(key => {
        const resources = ros[key as keyof typeof ros];
        return resources === undefined || isUniqueStringArray(resources, item => ROS_RESOURCE_PATTERN.test(item));
      })
    ) {
      return false;
    }
  } else if (candidate.ros !== undefined) {
    return false;
  }

  if (capabilities.includes('network')) {
    const network = candidate.network;
    if (!network || typeof network !== 'object' || Array.isArray(network)) return false;
    if (Object.keys(network).some(key => !['origins', 'hostEndpoints'].includes(key))) return false;
    if (
      network.origins !== undefined &&
      !isUniqueStringArray(
        network.origins,
        item => {
          if (item === 'self' || item === 'https:') return true;
          try {
            const url = new URL(item);
            return url.protocol === 'https:' && url.origin === item;
          } catch {
            return false;
          }
        },
        30
      )
    ) {
      return false;
    }
    if (
      network.hostEndpoints !== undefined &&
      !isUniqueStringArray(network.hostEndpoints, item => HOST_ENDPOINTS.has(item), HOST_ENDPOINTS.size)
    ) {
      return false;
    }
  } else if (candidate.network !== undefined) {
    return false;
  }
  return true;
};

const isPanelAssetArray = (value: unknown): value is NonNullable<RoboBoyPanelManifest['assets']> => {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(asset => {
      if (!asset || typeof asset !== 'object') return false;
      const candidate = asset as { path?: unknown; integrity?: unknown; offline?: unknown };
      return (
        isNonEmptyString(candidate.path, 2048) &&
        typeof candidate.integrity === 'string' &&
        PANEL_INTEGRITY_PATTERN.test(candidate.integrity) &&
        (candidate.offline === undefined || typeof candidate.offline === 'boolean')
      );
    })
  );
};

const isManifestShape = (value: unknown): value is RoboBoyPanelManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RoboBoyPanelManifest>;
  const compatibility = candidate.compatibility;
  const author = candidate.author;
  const capabilities = candidate.capabilities;
  const normalizedCapabilities = capabilities || [];

  return (
    candidate.schemaVersion === 1 &&
    isValidPanelId(candidate.id) &&
    isNonEmptyString(candidate.name, 120) &&
    isNonEmptyString(candidate.description, 1000) &&
    typeof candidate.version === 'string' &&
    Boolean(valid(candidate.version)) &&
    isNonEmptyString(candidate.entryPoint, 2048) &&
    typeof candidate.integrity === 'string' &&
    PANEL_INTEGRITY_PATTERN.test(candidate.integrity) &&
    (!candidate.assets || isPanelAssetArray(candidate.assets)) &&
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
    isPanelPermissions(candidate.permissions, normalizedCapabilities) &&
    (!candidate.tags || isStringArray(candidate.tags)) &&
    (!candidate.icon || isNonEmptyString(candidate.icon, 2048)) &&
    (!candidate.preview || isNonEmptyString(candidate.preview, 2048))
  );
};

const hasVersionPathSegment = (url: URL, version: string): boolean => {
  try {
    return url.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment))
      .includes(version);
  } catch {
    return false;
  }
};

const resolveSameOriginEntryPoint = (entryPoint: string, registryUrl: string): string | null => {
  try {
    const registry = new URL(registryUrl);
    const resolved = new URL(entryPoint, registry);
    const isSameLocation = resolved.protocol === registry.protocol && resolved.host === registry.host;
    const isLoadableProtocol = ['http:', 'https:', 'tauri:', 'asset:', 'customprotocol:'].includes(resolved.protocol);
    const hasStableUrlShape = !resolved.username && !resolved.password && !resolved.search && !resolved.hash;
    return isSameLocation && isLoadableProtocol && hasStableUrlShape ? resolved.href : null;
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

  if (document.panels.length > MAX_INSTALLED_PANELS) {
    return {
      panels,
      issues: [
        {
          code: 'invalid-registry',
          message: `The installed panel registry exceeds the ${MAX_INSTALLED_PANELS}-panel safety limit.`,
        },
      ],
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
    if (!entryPoint || !hasVersionPathSegment(new URL(entryPoint), candidate.version)) {
      issues.push({
        code: 'invalid-entry-point',
        panelId: candidate.id,
        message: `${candidate.name} must use a same-origin entry point with ${candidate.version} as an immutable path segment.`,
      });
      knownIds.add(candidate.id);
      return;
    }

    const assets = candidate.assets?.map(asset => {
      const path = resolveSameOriginEntryPoint(asset.path, entryPoint);
      const releaseDirectory = new URL('.', entryPoint);
      return path &&
        new URL(path).pathname.startsWith(releaseDirectory.pathname) &&
        hasVersionPathSegment(new URL(path), candidate.version)
        ? { ...asset, path }
        : null;
    });
    if (assets?.some(asset => asset === null)) {
      issues.push({
        code: 'invalid-entry-point',
        panelId: candidate.id,
        message: `${candidate.name} declares an asset outside its same-origin versioned release path.`,
      });
      knownIds.add(candidate.id);
      return;
    }

    knownIds.add(candidate.id);
    panels.push({
      ...candidate,
      entryPoint,
      assets: assets?.filter((asset): asset is NonNullable<typeof asset> => asset !== null),
      registryUrl,
    });
  });

  const installation = parseInstallationMetadata(document.installation);
  return { panels, issues, ...(installation ? { installation } : {}) };
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
    const declaredLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REGISTRY_BYTES) {
      throw new Error(`registry exceeds ${MAX_REGISTRY_BYTES} bytes`);
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REGISTRY_BYTES) {
      throw new Error(`registry exceeds ${MAX_REGISTRY_BYTES} bytes`);
    }
    return parseInstalledPanelRegistry(JSON.parse(body), registryUrl);
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
