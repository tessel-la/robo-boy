export const LEGACY_WORKSPACE_OWNER_KEY = 'robo-boy-workspace-legacy-owner-v1';

export const getConnectionStorageKey = (key: string, storageScope?: string): string =>
  storageScope ? `${key}:connection:${storageScope}` : key;

export const readConnectionStorage = (key: string, storageScope?: string): string | null => {
  if (!storageScope) return localStorage.getItem(key);

  const scopedValue = localStorage.getItem(getConnectionStorageKey(key, storageScope));
  if (scopedValue !== null) return scopedValue;

  const legacyOwner = localStorage.getItem(LEGACY_WORKSPACE_OWNER_KEY);
  if (legacyOwner && legacyOwner !== storageScope) return null;
  if (!legacyOwner) localStorage.setItem(LEGACY_WORKSPACE_OWNER_KEY, storageScope);
  return localStorage.getItem(key);
};

export const writeConnectionStorage = (key: string, value: string, storageScope?: string): void => {
  localStorage.setItem(getConnectionStorageKey(key, storageScope), value);
};

export const removeConnectionStorage = (key: string, storageScope?: string): void => {
  localStorage.removeItem(getConnectionStorageKey(key, storageScope));
};
