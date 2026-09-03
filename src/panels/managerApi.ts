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

/** Same-origin by construction: this API exists only in the web deployment that serves the app. */
const managerRequest = async <T>(path: string, token: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/panels/${path}`, {
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

/** Unauthenticated by design: it reports whether anything else here needs a token. */
export const fetchPanelManagerStatus = async (): Promise<{ authenticationRequired: boolean }> => {
  const response = await fetch('/api/panels/status', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Panel manager returned HTTP ${response.status}.`);
  return (await response.json()) as { authenticationRequired: boolean };
};

export const loadPanelManagerConfig = (token: string) =>
  managerRequest<{ config: PanelSourcesConfig; startupError?: string }>('config', token);

export const previewPanelManagerConfig = (token: string, config: PanelSourcesConfig) =>
  managerRequest<PanelInstallPreview>('preview', token, {
    method: 'POST',
    body: JSON.stringify({ config }),
  });

export const applyPanelManagerPlan = (token: string, planId: string) =>
  managerRequest<{ installed: number }>('apply', token, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });

/** Names a source the deployment has configured; it owns the catalog URL, not the caller. */
export const listPanelCatalog = (token: string, sourceName: string) =>
  managerRequest<{ panels: CatalogPanelSummary[] }>('catalog', token, {
    method: 'POST',
    body: JSON.stringify({ sourceName }),
  });
