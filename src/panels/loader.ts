import { ROBOBOY_PANEL_API_VERSION } from './constants';
import { isPanelModule } from './types';
import type { PanelModuleImporter, ResolvedPanelManifest, RoboBoyPanelDefinition } from './types';

const panelModuleCache = new Map<string, Promise<RoboBoyPanelDefinition>>();

const defaultPanelImporter: PanelModuleImporter = entryPoint => import(/* @vite-ignore */ entryPoint);

export class PanelLoadError extends Error {
  constructor(
    message: string,
    readonly code: 'import-failed' | 'invalid-module' | 'definition-mismatch'
  ) {
    super(message);
    this.name = 'PanelLoadError';
  }
}

export const loadExternalPanelDefinition = (
  manifest: ResolvedPanelManifest,
  importer: PanelModuleImporter = defaultPanelImporter
): Promise<RoboBoyPanelDefinition> => {
  const cacheKey = `${manifest.id}@${manifest.version}:${manifest.entryPoint}`;
  const cached = panelModuleCache.get(cacheKey);
  if (cached) return cached;

  const pending = importer(manifest.entryPoint)
    .catch(error => {
      throw new PanelLoadError(
        `Unable to import ${manifest.name}: ${error instanceof Error ? error.message : String(error)}`,
        'import-failed'
      );
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
      if (module.default.apiVersion !== ROBOBOY_PANEL_API_VERSION) {
        throw new PanelLoadError(
          `${manifest.name} targets panel API ${module.default.apiVersion}; expected ${ROBOBOY_PANEL_API_VERSION}.`,
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
