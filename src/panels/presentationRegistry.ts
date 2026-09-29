import { getConnectionStorageKey } from '../runtime/connectionStorage';

/** Live views are scoped like saved panels. A stale unmount cannot remove a replacement view. */
export function createPanelPresentationRegistry<T>() {
  const entries = new Map<string, T>();
  return {
    register(id: string, presentation: T, storageScope?: string): () => void {
      const key = getConnectionStorageKey(id, storageScope);
      entries.set(key, presentation);
      return () => {
        if (entries.get(key) === presentation) entries.delete(key);
      };
    },
    get(id: string, storageScope?: string): T | null {
      return entries.get(getConnectionStorageKey(id, storageScope)) ?? null;
    },
  };
}
