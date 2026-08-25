import { describe, expect, it, vi } from 'vitest';
import { loadInstalledPanelRegistry, parseInstalledPanelRegistry } from './registry';

const registryUrl = 'https://roboboy.test/panels/installed.json';

const createManifest = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'com.example.telemetry',
  name: 'Telemetry',
  description: 'Shows robot telemetry.',
  version: '1.2.3',
  entryPoint: './telemetry/index.js',
  compatibility: {
    panelApi: '^1.0.0',
    roboboy: '>=0.3.0-0 <1.0.0',
  },
  capabilities: ['ros'],
  author: { name: 'Example Author', url: 'https://example.com' },
  repository: 'https://github.com/example/telemetry-panel',
  tags: ['telemetry'],
  ...overrides,
});

describe('installed panel registry', () => {
  it('validates and resolves a compatible same-origin panel', () => {
    const result = parseInstalledPanelRegistry({ schemaVersion: 1, panels: [createManifest()] }, registryUrl, {
      hostVersion: '0.3.1-alpha',
    });

    expect(result.issues).toEqual([]);
    expect(result.panels).toEqual([
      expect.objectContaining({
        id: 'com.example.telemetry',
        entryPoint: 'https://roboboy.test/panels/telemetry/index.js',
        registryUrl,
      }),
    ]);
  });

  it('rejects invalid metadata and a missing entry point', () => {
    const result = parseInstalledPanelRegistry(
      {
        schemaVersion: 1,
        panels: [createManifest({ name: '' }), createManifest({ id: 'com.example.missing', entryPoint: '' })],
      },
      registryUrl
    );

    expect(result.panels).toEqual([]);
    expect(result.issues.map(issue => issue.code)).toEqual(['invalid-manifest', 'invalid-manifest']);
  });

  it('rejects incompatible Robo-Boy and panel API versions before loading code', () => {
    const result = parseInstalledPanelRegistry(
      {
        schemaVersion: 1,
        panels: [
          createManifest({ id: 'com.example.future-api', compatibility: { panelApi: '^2.0.0', roboboy: '*' } }),
          createManifest({ id: 'com.example.future-app', compatibility: { panelApi: '^1.0.0', roboboy: '>=2.0.0' } }),
        ],
      },
      registryUrl,
      { hostVersion: '0.3.1-alpha' }
    );

    expect(result.panels).toEqual([]);
    expect(result.issues.map(issue => issue.code)).toEqual(['incompatible-panel-api', 'incompatible-roboboy']);
  });

  it('rejects duplicate external IDs and collisions with built-ins', () => {
    const result = parseInstalledPanelRegistry(
      {
        schemaVersion: 1,
        panels: [createManifest(), createManifest({ version: '1.2.4' }), createManifest({ id: 'camera' })],
      },
      registryUrl
    );

    expect(result.panels.map(panel => panel.id)).toEqual(['com.example.telemetry']);
    expect(result.issues.map(issue => issue.code)).toEqual(['duplicate-id', 'duplicate-id']);
  });

  it('rejects cross-origin runtime entry points', () => {
    const result = parseInstalledPanelRegistry(
      { schemaVersion: 1, panels: [createManifest({ entryPoint: 'https://cdn.example.com/panel.js' })] },
      registryUrl
    );

    expect(result.panels).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: 'invalid-entry-point', panelId: 'com.example.telemetry' });
  });

  it('reports an unavailable registry without throwing', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));

    await expect(loadInstalledPanelRegistry(registryUrl, fetcher)).resolves.toEqual({
      panels: [],
      issues: [expect.objectContaining({ code: 'registry-unavailable', message: expect.stringContaining('offline') })],
    });
  });
});
