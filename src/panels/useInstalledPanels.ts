import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { loadLocalPanelRegistry } from './localPanels';
import { loadDisabledPanelIds, storeDisabledPanelIds } from './panelActivation';
import { loadInstalledPanelRegistry } from './registry';
import type { InstalledPanelRegistryResult, ResolvedPanelManifest } from './types';

/** Where a panel came from, which decides whether the manager may remove it. */
export type PanelOrigin = 'bundled' | 'installed';

export interface AvailablePanel {
  manifest: ResolvedPanelManifest;
  origin: PanelOrigin;
  isEnabled: boolean;
}

type RegistryState = InstalledPanelRegistryResult & { managed: ResolvedPanelManifest[] };

const EMPTY_RESULT: RegistryState = { panels: [], issues: [], managed: [] };

export const useInstalledPanels = (): InstalledPanelRegistryResult & {
  /** Every panel this build can run, with its origin and whether the user has it switched on. */
  allPanels: AvailablePanel[];
  /** Panels the manager may install or remove. Excludes panels that came with the build. */
  managedPanels: ResolvedPanelManifest[];
  isLoading: boolean;
  refresh: () => Promise<void>;
  setPanelEnabled: (panelId: string, isEnabled: boolean) => void;
} => {
  const isDesktop = useRuntimeConfig().mode === 'desktop';
  const [result, setResult] = useState<RegistryState>(EMPTY_RESULT);
  const [disabledIds, setDisabledIds] = useState<string[]>(loadDisabledPanelIds);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (): Promise<RegistryState> => {
    if (isDesktop) return loadLocalPanelRegistry();
    // The deployment's registry is exactly what its manager installed.
    const registry = await loadInstalledPanelRegistry();
    return { ...registry, managed: registry.panels };
  }, [isDesktop]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const nextResult = await load();
    setResult(nextResult);
    setIsLoading(false);
    nextResult.issues.forEach(issue => console.warn(`[external panels] ${issue.message}`));
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    load().then(nextResult => {
      if (cancelled) return;
      setResult(nextResult);
      setIsLoading(false);
      nextResult.issues.forEach(issue => console.warn(`[external panels] ${issue.message}`));
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const setPanelEnabled = useCallback((panelId: string, isEnabled: boolean) => {
    setDisabledIds(current => {
      const next = isEnabled ? current.filter(id => id !== panelId) : [...new Set([...current, panelId])];
      storeDisabledPanelIds(next);
      return next;
    });
  }, []);

  const allPanels = useMemo<AvailablePanel[]>(() => {
    const managedIds = new Set(result.managed.map(panel => panel.id));
    return result.panels.map(manifest => ({
      manifest,
      origin: managedIds.has(manifest.id) ? 'installed' : 'bundled',
      isEnabled: !disabledIds.includes(manifest.id),
    }));
  }, [disabledIds, result]);

  // A disabled panel stays installed but is not offered to the workspace.
  const panels = useMemo(
    () => allPanels.filter(panel => panel.isEnabled).map(panel => panel.manifest),
    [allPanels]
  );

  return {
    panels,
    issues: result.issues,
    allPanels,
    managedPanels: result.managed,
    isLoading,
    refresh,
    setPanelEnabled,
  };
};
