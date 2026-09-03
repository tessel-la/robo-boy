import { describe, expect, it } from 'vitest';
import {
  LOCAL_PANEL_ORIGIN,
  LOCAL_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_URL,
  createLocalPanelFetcher,
  createMemoryPanelStore,
} from './localPanelStore';
import { loadInstalledPanelRegistry } from './registry';
import { loadVerifiedExternalPanelSource } from './loader';
import { getSha256Integrity } from './sha256';

const bundleSource = "export default { id: 'com.example.telemetry' };\n";

const buildRegistry = (integrity: string) => ({
  schemaVersion: 1,
  panels: [
    {
      schemaVersion: 1,
      id: 'com.example.telemetry',
      name: 'Telemetry',
      description: 'Shows robot telemetry.',
      version: '1.2.3',
      entryPoint: './com.example.telemetry/1.2.3/index.js',
      integrity,
      compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
      capabilities: [],
      author: { name: 'Example Author', url: 'https://example.com' },
      repository: 'https://github.com/example/telemetry-panel',
    },
  ],
});

const seedStore = async () => {
  const integrity = await getSha256Integrity(new TextEncoder().encode(bundleSource));
  return {
    integrity,
    store: createMemoryPanelStore({
      [LOCAL_PANEL_REGISTRY_PATH]: JSON.stringify(buildRegistry(integrity)),
      'com.example.telemetry/1.2.3/index.js': bundleSource,
    }),
  };
};

describe('local panel store', () => {
  it('serves an installed registry through the standard registry loader', async () => {
    const { store } = await seedStore();

    const result = await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, createLocalPanelFetcher(store));

    expect(result.issues).toEqual([]);
    expect(result.panels).toEqual([
      expect.objectContaining({
        id: 'com.example.telemetry',
        entryPoint: `${LOCAL_PANEL_ORIGIN}/com.example.telemetry/1.2.3/index.js`,
      }),
    ]);
  });

  it('verifies bundle integrity for locally installed panels', async () => {
    const { store } = await seedStore();
    const fetcher = createLocalPanelFetcher(store);
    const [panel] = (await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, fetcher)).panels;

    await expect(loadVerifiedExternalPanelSource(panel, fetcher)).resolves.toBe(bundleSource);

    await store.write('com.example.telemetry/1.2.3/index.js', `${bundleSource}// tampered\n`);
    await expect(loadVerifiedExternalPanelSource(panel, fetcher)).rejects.toThrow(/Unable to verify/);
  });

  it('reports a missing bundle instead of serving something else', async () => {
    const { store } = await seedStore();
    await store.remove('com.example.telemetry/1.2.3/index.js');
    const fetcher = createLocalPanelFetcher(store);
    const [panel] = (await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, fetcher)).panels;

    await expect(loadVerifiedExternalPanelSource(panel, fetcher)).rejects.toThrow(/HTTP 404/);
  });

  it('refuses to answer for any origin other than local panel storage', async () => {
    const { store } = await seedStore();

    await expect(createLocalPanelFetcher(store)('https://cdn.example.com/panel.js')).rejects.toThrow(/Refusing to serve/);
  });
});
