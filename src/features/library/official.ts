import catalogData from '../../../library/catalog.json';
import pandaSource from '../../../library/generic/panda-inspection/1.0.0.json?raw';
import genericSource from '../../../library/generic/inspection/1.0.0.json?raw';
import genesisSource from '../../../library/genesis-manipulator/control/1.0.0.json?raw';
import { checkedRelease } from './catalog';
import type { Catalog, CachedRelease, LibrarySource } from './store';
export const OFFICIAL_SOURCE_ID = 'roboboy-official-content';
export const OFFICIAL_CATALOG_URL = 'https://raw.githubusercontent.com/tessel-la/robo-boy-catalog/main/catalog.json';
export const officialSource: LibrarySource = {
  id: OFFICIAL_SOURCE_ID,
  title: 'Official',
  type: 'https',
  url: OFFICIAL_CATALOG_URL,
  updatedAt: 0,
  catalog: catalogData as Catalog,
};
/** Cached relative paths are valid only for the endpoint that published them. */
export const catalogSources = (saved: LibrarySource[]): LibrarySource[] => {
  const official = saved.find(source => source.id === OFFICIAL_SOURCE_ID);
  return [
    official && official.url === officialSource.url ? official : officialSource,
    ...saved.filter(source => source.id !== OFFICIAL_SOURCE_ID),
  ];
};
export const bundledReleases: CachedRelease[] = [pandaSource, genericSource, genesisSource].map((source, index) =>
  checkedRelease(source, catalogData.items[index] as Catalog['items'][number])
);
