import { useCallback, useEffect, useState } from 'react';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { LOCAL_PANEL_REGISTRY_URL } from './localPanelStore';
import { localPanelFetcher } from './localPanels';
import { loadInstalledPanelRegistry } from './registry';
import type { InstalledPanelRegistryResult } from './types';

const EMPTY_RESULT: InstalledPanelRegistryResult = { panels: [], issues: [] };

export const useInstalledPanels = (): InstalledPanelRegistryResult & {
  isLoading: boolean;
  refresh: () => Promise<void>;
} => {
  // The desktop shell installs panels into its own storage: it has no deployment to read them
  // from, and requiring one would tie the packaged app to the web stack.
  const isDesktop = useRuntimeConfig().mode === 'desktop';
  const [result, setResult] = useState<InstalledPanelRegistryResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(
    () =>
      isDesktop
        ? loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, localPanelFetcher)
        : loadInstalledPanelRegistry(),
    [isDesktop]
  );

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

  return { ...result, isLoading, refresh };
};
