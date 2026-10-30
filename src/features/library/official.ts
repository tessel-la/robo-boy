import catalogData from '../../../library/catalog.json';
import pandaSource from '../../../library/generic/panda-inspection/1.0.0.json?raw';
import genericSource from '../../../library/generic/inspection/1.0.0.json?raw';
import genesisSource from '../../../library/genesis/control/1.0.0.json?raw';
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
export const bundledReleases: CachedRelease[] = [pandaSource, genericSource, genesisSource].map((source, index) =>
  checkedRelease(source, catalogData.items[index] as Catalog['items'][number])
);
