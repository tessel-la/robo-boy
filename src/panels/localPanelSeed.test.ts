import { describe, expect, it } from 'vitest';
import { seedLocalPanelsFromBundle } from './localPanelSeed';
import {
  BUNDLED_PANEL_REGISTRY_PATH,
  BUNDLED_PANEL_REGISTRY_URL,
  LOCAL_PANEL_REGISTRY_PATH,
  createLocalPanelFetcher,
  createMemoryPanelStore,
} from './localPanelStore';
import { loadInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

const BASE = 'tauri://localhost/';
const sourceFor = (id: string) => `export default { id: '${id}' };\n`;

const manifestFor = async (id: string, name: string) => ({
  schemaVersion: 1,
  id,
  name,
  description: `Bundled ${name}.`,
  version: '1.0.0',
  entryPoint: `./${id}/1.0.0/index.js`,
  integrity: await getSha256Integrity(new TextEncoder().encode(sourceFor(id))),
  compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
  capabilities: [],
  author: { name: 'Tessel LA' },
  repository: 'https://github.com/tessel-la/robo-boy',
});

const buildFetcher = async (ids: string[], overrides: { bundle?: string; omitBundle?: boolean } = {}) => {
  const panels = await Promise.all(ids.map(id => manifestFor(id, id)));
  return (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.endsWith('panels/installed.json')) return new Response(JSON.stringify({ schemaVersion: 1, panels }));
    const match = ids.find(id => href.includes(`/${id}/1.0.0/index.js`));
    if (!match) return new Response(null, { status: 404 });
    if (overrides.omitBundle) return new Response(null, { status: 404 });
    return new Response(overrides.bundle ?? sourceFor(match));
  }) as typeof fetch;
};

const userInstalled = {
  schemaVersion: 1,
  panels: [
    {
      schemaVersion: 1,
      id: 'com.example.user-installed',
      name: 'User installed',
      description: 'Installed through the manager.',
      version: '3.1.0',
      entryPoint: './com.example.user-installed/3.1.0/index.js',
      integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
      compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
      capabilities: [],
      author: { name: 'Example' },
      repository: 'https://github.com/example/user-installed',
    },
  ],
};

describe('bundled panel seeding', () => {
  it('keeps the panels a build ships in their own registry', async () => {
    const store = createMemoryPanelStore();

    const seeded = await seedLocalPanelsFromBundle(store, await buildFetcher(['la.tessel.roboboy.duck']), BASE);

    expect(seeded).toEqual(['la.tessel.roboboy.duck']);
    const registry = await loadInstalledPanelRegistry(BUNDLED_PANEL_REGISTRY_URL, createLocalPanelFetcher(store));
    expect(registry.issues).toEqual([]);
    expect(registry.panels.map(panel => panel.id)).toEqual(['la.tessel.roboboy.duck']);
    expect(await store.read('bundled/la.tessel.roboboy.duck/1.0.0/index.js')).not.toBeNull();
  });

  it('never touches panels installed through the manager', async () => {
    const store = createMemoryPanelStore({ [LOCAL_PANEL_REGISTRY_PATH]: JSON.stringify(userInstalled) });

    await seedLocalPanelsFromBundle(store, await buildFetcher(['la.tessel.roboboy.duck']), BASE);

    expect(JSON.parse((await store.read(LOCAL_PANEL_REGISTRY_PATH))!)).toEqual(userInstalled);
  });

  it('mirrors the build, dropping a panel it no longer ships', async () => {
    const store = createMemoryPanelStore();
    await seedLocalPanelsFromBundle(store, await buildFetcher(['a.b.first', 'a.b.second']), BASE);

    await seedLocalPanelsFromBundle(store, await buildFetcher(['a.b.first']), BASE);

    const registry = JSON.parse((await store.read(BUNDLED_PANEL_REGISTRY_PATH))!);
    expect(registry.panels.map((panel: { id: string }) => panel.id)).toEqual(['a.b.first']);
    expect(await store.read('bundled/a.b.second/1.0.0/index.js')).toBeNull();
  });

  it('clears bundled panels when a build ships none', async () => {
    const store = createMemoryPanelStore();
    await seedLocalPanelsFromBundle(store, await buildFetcher(['a.b.first']), BASE);

    const plainBuild = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect(await seedLocalPanelsFromBundle(store, plainBuild, BASE)).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it('refuses a bundled panel whose bytes do not match its manifest', async () => {
    const store = createMemoryPanelStore();
    const fetcher = await buildFetcher(['a.b.first'], { bundle: 'export default {};\n// tampered\n' });

    await expect(seedLocalPanelsFromBundle(store, fetcher, BASE)).rejects.toThrow(/failed integrity verification/);
    expect(await store.list()).toEqual([]);
  });

  it('reports a listed panel whose bundle is missing from the build', async () => {
    const fetcher = await buildFetcher(['a.b.first'], { omitBundle: true });

    await expect(seedLocalPanelsFromBundle(createMemoryPanelStore(), fetcher, BASE)).rejects.toThrow(/bundle is missing/);
  });
});
