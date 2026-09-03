import type { RoboBoyPanelManifest } from './types';

export interface RemotePanelSourceConfig {
  type: 'remote';
  name: string;
  catalogUrl: string;
  allowedOrigins?: string[];
  authorizationEnv?: string;
  authenticatedOrigins?: string[];
}

export interface LocalPanelSourceConfig {
  type: 'local';
  name: string;
  root?: string;
  rootEnv?: string;
  repositories: string[];
}

export type PanelSourceConfig = RemotePanelSourceConfig | LocalPanelSourceConfig;

export interface PanelSourcesConfig {
  schemaVersion: 2;
  sources: PanelSourceConfig[];
  selection: { mode: 'all' | 'none' } | { mode: 'include'; panelIds: string[] };
}

export interface PanelInstallChange {
  type: 'add' | 'update' | 'remove';
  panel: RoboBoyPanelManifest;
  previousVersion?: string;
}

export interface PanelInstallPreview {
  planId: string;
  expiresInSeconds: number;
  panels: RoboBoyPanelManifest[];
  changes: PanelInstallChange[];
}

export interface CatalogPanelSummary {
  id: string;
  name: string;
  description: string;
  version: string;
}

/**
 * `baseUrl` is empty in the browser, where the page and `/api/panels` share an origin. The
 * packaged desktop shell serves its own assets, so it must name the deployment's proxy origin
 * explicitly -- otherwise the request resolves against the app bundle and returns index.html.
 */
const managerRequest = async <T>(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}/api/panels/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`Panel manager returned HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Panel manager returned HTTP ${response.status}.`
    );
  }
  return body as T;
};

export const loadPanelManagerConfig = (baseUrl: string, token: string) =>
  managerRequest<{ config: PanelSourcesConfig; startupError?: string }>(baseUrl, 'config', token);

export const previewPanelManagerConfig = (baseUrl: string, token: string, config: PanelSourcesConfig) =>
  managerRequest<PanelInstallPreview>(baseUrl, 'preview', token, {
    method: 'POST',
    body: JSON.stringify({ config }),
  });

export const applyPanelManagerPlan = (baseUrl: string, token: string, planId: string) =>
  managerRequest<{ installed: number }>(baseUrl, 'apply', token, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });

export const listPanelCatalog = (baseUrl: string, token: string, source: RemotePanelSourceConfig) =>
  managerRequest<{ panels: CatalogPanelSummary[] }>(baseUrl, 'catalog', token, {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
