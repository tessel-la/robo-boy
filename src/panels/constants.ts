import type { RemotePanelSourceConfig } from './managerApi';

export const ROBOBOY_PANEL_API_VERSION = '2.0.0' as const;
export const DEFAULT_INSTALLED_PANEL_REGISTRY_PATH = 'panels/installed.json';

// Mirrors config/panel-sources.official.json's remote source exactly -- see
// src/panels/constants.test.ts for a drift guard between the two.
export const OFFICIAL_PANEL_SOURCE: RemotePanelSourceConfig = {
  type: 'remote',
  name: 'roboboy-official',
  catalogUrl: 'https://raw.githubusercontent.com/tessel-la/robo-boy-panel-inventory/main/catalog.json',
  allowedOrigins: [
    'https://github.com',
    'https://objects.githubusercontent.com',
    'https://release-assets.githubusercontent.com',
  ],
};
