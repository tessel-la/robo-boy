import { satisfies, valid } from 'semver';
import { ROBOBOY_PANEL_API_VERSION } from './constants';
import { getSha256Integrity } from './sha256';
import { isPanelModule } from './types';
import type { PanelModuleImporter, ResolvedPanelManifest, RoboBoyPanelDefinition } from './types';

const panelModuleCache = new Map<string, Promise<RoboBoyPanelDefinition>>();

const defaultPanelImporter: PanelModuleImporter = entryPoint => import(/* @vite-ignore */ entryPoint);

export class PanelLoadError extends Error {
  constructor(
    message: string,
    readonly code: 'import-failed' | 'integrity-failed' | 'invalid-module' | 'definition-mismatch'
  ) {
    super(message);
    this.name = 'PanelLoadError';
  }
}

export const verifyExternalPanelIntegrity = async (
  manifest: ResolvedPanelManifest,
  fetcher: typeof fetch = fetch
): Promise<void> => {
  try {
    const response = await fetcher(manifest.entryPoint, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const actual = await getSha256Integrity(new Uint8Array(await response.arrayBuffer()));
    if (actual !== manifest.integrity) {
      throw new Error(`expected ${manifest.integrity}, received ${actual}`);
    }
  } catch (error) {
    throw new PanelLoadError(
      `Unable to verify ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
      'integrity-failed'
    );
  }
};

export const loadExternalPanelDefinition = (
  manifest: ResolvedPanelManifest,
  importer: PanelModuleImporter = defaultPanelImporter
): Promise<RoboBoyPanelDefinition> => {
  const cacheKey = `${manifest.id}@${manifest.version}:${manifest.integrity}:${manifest.entryPoint}`;
  const cached = panelModuleCache.get(cacheKey);
  if (cached) return cached;

  const verify = importer === defaultPanelImporter ? verifyExternalPanelIntegrity(manifest) : Promise.resolve();
  const pending = verify
    .then(async () => {
      try {
        return await importer(manifest.entryPoint);
      } catch (error) {
        throw new PanelLoadError(
          `Unable to import ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
          'import-failed'
        );
      }
    })
    .then(module => {
      if (!isPanelModule(module)) {
        throw new PanelLoadError(`${manifest.name} did not export a valid default panel definition.`, 'invalid-module');
      }
      if (module.default.id !== manifest.id) {
        throw new PanelLoadError(
          `${manifest.name} exported panel ID ${module.default.id}; expected ${manifest.id}.`,
          'definition-mismatch'
        );
      }
      if (
        !valid(module.default.apiVersion) ||
        !satisfies(ROBOBOY_PANEL_API_VERSION, `^${module.default.apiVersion}`, { includePrerelease: true })
      ) {
        throw new PanelLoadError(
          `${manifest.name} targets panel API ${module.default.apiVersion}; this host provides ${ROBOBOY_PANEL_API_VERSION}.`,
          'definition-mismatch'
        );
      }
      return module.default;
    })
    .catch(error => {
      panelModuleCache.delete(cacheKey);
      throw error;
    });

  panelModuleCache.set(cacheKey, pending);
  return pending;
};

export const clearExternalPanelModuleCache = (): void => {
  panelModuleCache.clear();
};
