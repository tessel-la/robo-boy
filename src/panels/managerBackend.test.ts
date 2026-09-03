import { describe, expect, it } from 'vitest';
import { createLocalPanelManagerBackend } from './managerBackend';
import { createMemoryPanelStore } from './localPanelStore';
import { getSha256Integrity } from './sha256';
import type { PanelSourcesConfig } from './managerApi';

const CATALOG = 'https://raw.githubusercontent.com/tessel-la/inventory/main/catalog.json';
const bundleSource = "export default { id: 'com.example.telemetry' };\n";

const buildFetcher = async () => {
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
          bundleUrl: './bundles/telemetry.js',
        },
      },
    },
    'https://raw.githubusercontent.com/tessel-la/inventory/main/manifests/telemetry.json': {
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
    },
  };
  return (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.endsWith('/bundles/telemetry.js')) return new Response(bundleSource);
    const body = routes[href];
    return body ? new Response(JSON.stringify(body)) : new Response(null, { status: 404 });
  }) as typeof fetch;
};

const config: PanelSourcesConfig = {
  schemaVersion: 2,
  sources: [{ type: 'remote', name: 'roboboy-official', catalogUrl: CATALOG }],
  selection: { mode: 'include', panelIds: ['com.example.telemetry'] },
};

describe('desktop panel manager backend', () => {
  it('needs no token, unlike the deployment manager service', () => {
    expect(createLocalPanelManagerBackend(createMemoryPanelStore()).requiresToken).toBe(false);
  });

  it('previews an install, applies it, and then reports nothing left to change', async () => {
    const store = createMemoryPanelStore();
    const backend = createLocalPanelManagerBackend(store, await buildFetcher());

    const preview = await backend.preview('', config);
    expect(preview.changes).toEqual([expect.objectContaining({ type: 'add' })]);
    expect(preview.panels.map(panel => panel.id)).toEqual(['com.example.telemetry']);

    await expect(backend.apply('', preview.planId)).resolves.toEqual({ installed: 1 });
    expect(await backend.loadConfig('')).toEqual({ config });

    expect((await backend.preview('', config)).changes).toEqual([]);
  });

  it('reports a removal when a previously installed panel is deselected', async () => {
    const store = createMemoryPanelStore();
    const backend = createLocalPanelManagerBackend(store, await buildFetcher());
    const preview = await backend.preview('', config);
    await backend.apply('', preview.planId);

    const cleared = { ...config, selection: { mode: 'include' as const, panelIds: [] } };

    expect((await backend.preview('', cleared)).changes).toEqual([expect.objectContaining({ type: 'remove' })]);
  });

  it('refuses to apply a plan it did not issue', async () => {
    const backend = createLocalPanelManagerBackend(createMemoryPanelStore(), await buildFetcher());

    await expect(backend.apply('', 'not-a-plan')).rejects.toThrow(/expired/);
  });
});
