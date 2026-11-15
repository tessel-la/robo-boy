import { fetchContent, readCatalog } from './catalog';
import { catalogSources } from './official';
import { readLibrarySnapshot, writeLibrary } from './store';

/** Check metadata on opening Catalog. Downloads and activation still require an explicit import. */
export async function checkCatalogSources(signal: AbortSignal): Promise<{ failed: boolean; newSources: string[] }> {
  const snapshot = await readLibrarySnapshot();
  const result = { failed: false, newSources: [] as string[] };
  for (const source of catalogSources(snapshot.sources)) {
    if (signal.aborted) break;
    if (source.type !== 'https' || !source.url) continue;
    try {
      const catalog = readCatalog(await fetchContent(source.url, signal));
      const previous = snapshot.sources.find(item => item.id === source.id);
      await writeLibrary(
        {
          refreshSources: [{ source: { ...source, catalog, title: catalog.title, updatedAt: Date.now() }, previous }],
        },
        signal
      );
      if (catalog.items.some(item => !source.catalog.items.some(saved => saved.id === item.id)))
        result.newSources.push(source.id);
    } catch {
      if (!signal.aborted) result.failed = true;
    }
  }
  return result;
}
