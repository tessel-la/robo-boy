import { describe, expect, it } from 'vitest';
import { installLocalPanels } from './localPanelInstaller';
import {
  LOCAL_PANEL_REGISTRY_PATH,
  LOCAL_PANEL_REGISTRY_URL,
  createLocalPanelFetcher,
  createMemoryPanelStore,
} from './localPanelStore';
import { loadInstalledPanelRegistry } from './registry';
import { getSha256Integrity } from './sha256';

const CATALOG = 'https://raw.githubusercontent.com/tessel-la/inventory/main/catalog.json';
const bundleSource = "export default { id: 'com.example.telemetry' };\n";

const manifestFor = (integrity: string) => ({
  schemaVersion: 1,
  id: 'com.example.telemetry',
  name: 'Telemetry',
  description: 'Shows robot telemetry.',
  version: '1.2.3',
  entryPoint: './index.js',
  integrity,
  compatibility: { panelApi: '^2.0.0', roboboy: '>=0.3.0-0 <1.0.0' },
  capabilities: [],
  author: { name: 'Example Author', url: 'https://example.com' },
  repository: 'https://github.com/example/telemetry-panel',
});

const buildFetcher = async (overrides: { bundle?: string; bundleUrl?: string } = {}) => {
  const integrity = await getSha256Integrity(new TextEncoder().encode(bundleSource));
  const routes: Record<string, unknown> = {
    [CATALOG]: { schemaVersion: 1, panels: ['./panels/telemetry.json'] },
    'https://raw.githubusercontent.com/tessel-la/inventory/main/panels/telemetry.json': {
      schemaVersion: 1,
      id: 'com.example.telemetry',
      latest: {
        version: '1.2.3',
        distribution: {
          type: 'javascript-bundle',
          integrity,
          manifestUrl: './manifests/telemetry.json',
          bundleUrl: overrides.bundleUrl ?? './bundles/telemetry.js',
        },
      },
    },
    'https://raw.githubusercontent.com/tessel-la/inventory/main/manifests/telemetry.json': manifestFor(integrity),
  };
  const bundleHref =
    overrides.bundleUrl ?? 'https://raw.githubusercontent.com/tessel-la/inventory/main/bundles/telemetry.js';

  const fetcher = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href === bundleHref) return new Response(overrides.bundle ?? bundleSource);
    const body = routes[href];
    if (!body) return new Response(null, { status: 404 });
    return new Response(JSON.stringify(body));
  }) as typeof fetch;

  return { fetcher, integrity };
};

const source = { name: 'roboboy-official', catalogUrl: CATALOG };

describe('desktop panel installation', () => {
  it('installs a verified panel that the runtime registry can then load', async () => {
    const { fetcher } = await buildFetcher();
    const store = createMemoryPanelStore();

    const result = await installLocalPanels({ source, selection: { mode: 'all' } }, store, fetcher);

    expect(result.installed).toEqual(['com.example.telemetry']);
    expect(await store.read('com.example.telemetry/1.2.3/index.js')).toBe(bundleSource);

    const registry = await loadInstalledPanelRegistry(LOCAL_PANEL_REGISTRY_URL, createLocalPanelFetcher(store));
    expect(registry.issues).toEqual([]);
    expect(registry.panels.map(panel => panel.id)).toEqual(['com.example.telemetry']);
  });

  it('refuses a bundle whose bytes do not match the published integrity', async () => {
    const { fetcher } = await buildFetcher({ bundle: `${bundleSource}// tampered\n` });
    const store = createMemoryPanelStore();

    await expect(installLocalPanels({ source, selection: { mode: 'all' } }, store, fetcher)).rejects.toThrow(
      /failed integrity verification/
    );
    expect(await store.list()).toEqual([]);
  });

  it('refuses a bundle served from an origin the source does not allow', async () => {
    const { fetcher } = await buildFetcher({ bundleUrl: 'https://cdn.evil.example/telemetry.js' });
    const store = createMemoryPanelStore();

    await expect(installLocalPanels({ source, selection: { mode: 'all' } }, store, fetcher)).rejects.toThrow(
      /unapproved origin/
    );
  });

  it('installs only the selected panels and drops what is no longer selected', async () => {
    const { fetcher } = await buildFetcher();
    const store = createMemoryPanelStore({ 'com.example.stale/9.9.9/index.js': 'stale' });

    await installLocalPanels({ source, selection: { mode: 'include', panelIds: [] } }, store, fetcher);

    expect(await store.list()).toEqual([LOCAL_PANEL_REGISTRY_PATH]);
  });
});
