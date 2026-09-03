const STORAGE_KEY = 'robo-boy-disabled-panels-v1';

/**
 * Panels the user has switched off. Activation is a local preference rather than an installation
 * state: it applies to bundled and installed panels alike, in both the web app and the packaged
 * shell, and turning a panel off never removes it.
 */
export const loadDisabledPanelIds = (): string[] => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const storeDisabledPanelIds = (ids: string[]): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable; activation then lasts for this session only.
  }
};
