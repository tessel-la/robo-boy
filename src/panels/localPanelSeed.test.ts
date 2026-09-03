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

  it('adds bundled panels without disturbing what the user already installed', async () => {
    const { fetcher } = await buildFetcher();
    const userPanel = {
      schemaVersion: 1,
      id: 'com.example.user-installed',
      name: 'User installed',
      description: 'Installed by the user from the catalog.',
      version: '3.1.0',
      entryPoint: './com.example.user-installed/3.1.0/index.js',
      integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
      compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
      capabilities: [],
      author: { name: 'Example' },
      repository: 'https://github.com/example/user-installed',
    };
    const store = createMemoryPanelStore({
      [LOCAL_PANEL_REGISTRY_PATH]: JSON.stringify({ schemaVersion: 1, panels: [userPanel] }),
    });

    expect(await seedLocalPanelsFromBundle(store, fetcher, BASE)).toEqual(['la.tessel.roboboy.microduck-control']);

    const registry = JSON.parse((await store.read(LOCAL_PANEL_REGISTRY_PATH))!);
    expect(registry.panels.map((panel: { id: string }) => panel.id)).toEqual([
      'com.example.user-installed',
      'la.tessel.roboboy.microduck-control',
    ]);
  });

  it('leaves a bundled panel the user removed removed', async () => {
    const { fetcher } = await buildFetcher();
    // Already offered once, and absent from the registry: the user took it out on purpose.
    const store = createMemoryPanelStore({
      [LOCAL_PANEL_REGISTRY_PATH]: '{"schemaVersion":1,"panels":[]}',
      'bundled-seed.json': JSON.stringify({ seeded: ['la.tessel.roboboy.microduck-control@1.0.0'] }),
    });

    expect(await seedLocalPanelsFromBundle(store, fetcher, BASE)).toEqual([]);
    expect(JSON.parse((await store.read(LOCAL_PANEL_REGISTRY_PATH))!).panels).toEqual([]);
  });

  it('keeps the installed version when a bundled panel shares its ID', async () => {
    const { fetcher } = await buildFetcher();
    const store = createMemoryPanelStore({
      [LOCAL_PANEL_REGISTRY_PATH]: JSON.stringify({
        schemaVersion: 1,
        panels: [
          {
            schemaVersion: 1,
            id: 'la.tessel.roboboy.microduck-control',
            name: 'Microduck control',
            description: 'A newer build the user installed.',
            version: '2.5.0',
            entryPoint: './la.tessel.roboboy.microduck-control/2.5.0/index.js',
            integrity: 'sha256-awLjC3PnQMe3GqvsLNqbulVO7zysg4XTJoKvBkR3kDk=',
            compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
            capabilities: [],
            author: { name: 'Tessel LA' },
            repository: 'https://github.com/tessel-la/robo-boy-microduck-control-panel',
          },
        ],
      }),
    });

    expect(await seedLocalPanelsFromBundle(store, fetcher, BASE)).toEqual([]);
    const registry = JSON.parse((await store.read(LOCAL_PANEL_REGISTRY_PATH))!);
    expect(registry.panels.map((panel: { version: string }) => panel.version)).toEqual(['2.5.0']);
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
