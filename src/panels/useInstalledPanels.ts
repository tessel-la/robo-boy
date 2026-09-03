import { useCallback, useEffect, useState } from 'react';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { loadInstalledPanelRegistry, resolveInstalledPanelRegistryUrl } from './registry';
import type { InstalledPanelRegistryResult } from './types';

const EMPTY_RESULT: InstalledPanelRegistryResult = { panels: [], issues: [] };

export const useInstalledPanels = (): InstalledPanelRegistryResult & {
  isLoading: boolean;
  refresh: () => Promise<void>;
} => {
  const { panelRegistryUrl } = useRuntimeConfig();
  const registryUrl = resolveInstalledPanelRegistryUrl(panelRegistryUrl);
  const [result, setResult] = useState<InstalledPanelRegistryResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const nextResult = await loadInstalledPanelRegistry(registryUrl);
    setResult(nextResult);
    setIsLoading(false);
    nextResult.issues.forEach(issue => console.warn(`[external panels] ${issue.message}`));
  }, [registryUrl]);

  useEffect(() => {
    let cancelled = false;
    loadInstalledPanelRegistry(registryUrl).then(nextResult => {
      if (cancelled) return;
      setResult(nextResult);
      setIsLoading(false);
      nextResult.issues.forEach(issue => console.warn(`[external panels] ${issue.message}`));
    });
    return () => {
      cancelled = true;
    };
  }, [registryUrl]);

  return { ...result, isLoading, refresh };
};
