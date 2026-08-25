import { useEffect, useState } from 'react';
import { loadInstalledPanelRegistry } from './registry';
import type { InstalledPanelRegistryResult } from './types';

const EMPTY_RESULT: InstalledPanelRegistryResult = { panels: [], issues: [] };

export const useInstalledPanels = (): InstalledPanelRegistryResult & { isLoading: boolean } => {
  const [result, setResult] = useState<InstalledPanelRegistryResult>(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadInstalledPanelRegistry().then(nextResult => {
      if (cancelled) return;
      setResult(nextResult);
      setIsLoading(false);
      nextResult.issues.forEach(issue => console.warn(`[external panels] ${issue.message}`));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...result, isLoading };
};
