import { useCallback, useEffect, useState } from 'react';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { loadLocalPanelRegistry } from './localPanels';
import { loadInstalledPanelRegistry } from './registry';
import type { InstalledPanelRegistryResult, ResolvedPanelManifest } from './types';

type RegistryState = InstalledPanelRegistryResult & { managed: ResolvedPanelManifest[] };

const EMPTY_RESULT: RegistryState = { panels: [], issues: [], managed: [] };

export const useInstalledPanels = (): InstalledPanelRegistryResult & {
  /** Panels the manager may add or remove. Excludes panels that came with the build. */
  managedPanels: ResolvedPanelManifest[];
  isLoading: boolean;
  refresh: () => Promise<void>;
} => {
  // The desktop shell installs panels into its own storage: it has no deployment to read them
  // from, and requiring one would tie the packaged app to the web stack.
  const isDesktop = useRuntimeConfig().mode === 'desktop';
  const [result, setResult] = useState<RegistryState>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (): Promise<RegistryState> => {
    if (isDesktop) return loadLocalPanelRegistry();
    // The deployment's registry is exactly what its manager installed.
    const result = await loadInstalledPanelRegistry();
    return { ...result, managed: result.panels };
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

  return { ...result, managedPanels: result.managed, isLoading, refresh };
};
