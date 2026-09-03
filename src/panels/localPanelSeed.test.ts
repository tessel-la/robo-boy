import { describe, expect, it } from 'vitest';
import { seedLocalPanelsFromBundle } from './localPanelSeed';
import {
  LOCAL_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_URL,
  createLocalPanelFetcher,
  createMemoryPanelStore,
} from './localPanelStore';
import { loadInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

const BASE = 'tauri://localhost/';
const bundleSource = "export default { id: 'la.tessel.roboboy.microduck-control' };\n";

const buildFetcher = async (overrides: { bundle?: string; omitBundle?: boolean } = {}) => {
  const integrity = await getSha256Integrity(new TextEncoder().encode(bundleSource));
  const registry = {
    schemaVersion: 1,
    panels: [
      {
        schemaVersion: 1,
        id: 'la.tessel.roboboy.microduck-control',
        name: 'Microduck control',
        description: 'Drives the Microduck.',
        version: '1.0.0',
        entryPoint: './la.tessel.roboboy.microduck-control/1.0.0/index.js',
        integrity,
        compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
        capabilities: [],
        author: { name: 'Tessel LA' },
        repository: 'https://github.com/tessel-la/robo-boy-microduck-control-panel',
      },
    ],
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.endsWith('panels/installed.json')) return new Response(JSON.stringify(registry));
    if (href.endsWith('/index.js')) {
      return overrides.omitBundle ? new Response(null, { status: 404 }) : new Response(overrides.bundle ?? bundleSource);
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, integrity };
};

describe('bundled panel seeding', () => {
  it('hands panels bundled into the build to the local store on first run', async () => {
    const { fetcher } = await buildFetcher();
    const store = createMemoryPanelStore();

    const seeded = await seedLocalPanelsFromBundle(store, fetcher, BASE);

    expect(seeded).toEqual(['la.tessel.roboboy.microduck-control']);
    const registry = await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, createLocalPanelFetcher(store));
    expect(registry.issues).toEqual([]);
    expect(registry.panels.map(panel => panel.id)).toEqual(['la.tessel.roboboy.microduck-control']);
  });

  it('never overwrites panels the user has already installed', async () => {
    const { fetcher } = await buildFetcher();
    const store = createMemoryPanelStore({ [LOCAL_PANEL_REGISTRY_PATH]: '{"schemaVersion":1,"panels":[]}' });

    expect(await seedLocalPanelsFromBundle(store, fetcher, BASE)).toEqual([]);
    expect(await store.read(LOCAL_PANEL_REGISTRY_PATH)).toBe('{"schemaVersion":1,"panels":[]}');
  });

  it('seeds nothing when the build ships no bundled panels', async () => {
    const fetcher = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const store = createMemoryPanelStore();

    expect(await seedLocalPanelsFromBundle(store, fetcher, BASE)).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it('refuses a bundled panel whose bytes do not match its manifest', async () => {
    const { fetcher } = await buildFetcher({ bundle: `${bundleSource}// tampered\n` });
    const store = createMemoryPanelStore();

    await expect(seedLocalPanelsFromBundle(store, fetcher, BASE)).rejects.toThrow(/failed integrity verification/);
    expect(await store.list()).toEqual([]);
  });

  it('reports a listed panel whose bundle is missing from the build', async () => {
    const { fetcher } = await buildFetcher({ omitBundle: true });

    await expect(seedLocalPanelsFromBundle(createMemoryPanelStore(), fetcher, BASE)).rejects.toThrow(/bundle is missing/);
  });
});
