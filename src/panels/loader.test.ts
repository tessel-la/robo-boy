import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearExternalPanelModuleCache, loadExternalPanelDefinition, verifyExternalPanelIntegrity } from './loader';
import type { ResolvedPanelManifest } from './types';

const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.panel',
  name: 'Example panel',
  description: 'An example.',
  version: '1.0.0',
  entryPoint: 'https://roboboy.test/panels/example/1.0.0/index.js',
  integrity: 'sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^1.0.0', roboboy: '*' },
  capabilities: [],
  author: { name: 'Example' },
  repository: 'https://github.com/example/panel',
};

const createDefinition = (overrides: Record<string, unknown> = {}) => ({
  apiVersion: '1.0.0',
  id: manifest.id,
  activate: vi.fn(),
  ...overrides,
});

describe('external panel loader', () => {
  beforeEach(() => clearExternalPanelModuleCache());
  afterEach(() => vi.unstubAllGlobals());

  it('loads and validates a panel module', async () => {
    const definition = createDefinition();
    const importer = vi.fn().mockResolvedValue({ default: definition });

    await expect(loadExternalPanelDefinition(manifest, importer)).resolves.toBe(definition);
    expect(importer).toHaveBeenCalledWith(manifest.entryPoint);
  });

  it('verifies the downloaded bundle against its declared SHA-256 digest', async () => {
    const body = new TextEncoder().encode('hello');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(body.buffer),
    });

    await expect(verifyExternalPanelIntegrity(manifest, fetcher as typeof fetch)).resolves.toBeUndefined();
    await expect(
      verifyExternalPanelIntegrity(
        { ...manifest, integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
        fetcher
      )
    ).rejects.toMatchObject({ code: 'integrity-failed' });
  });

  it('verifies the bundle when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const body = new TextEncoder().encode('hello');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(body.buffer),
    });

    await expect(verifyExternalPanelIntegrity(manifest, fetcher as typeof fetch)).resolves.toBeUndefined();
  });

  it('loads each panel bundle once and shares the pending promise', async () => {
    const definition = createDefinition();
    const importer = vi.fn().mockResolvedValue({ default: definition });

    const first = loadExternalPanelDefinition(manifest, importer);
    const second = loadExternalPanelDefinition(manifest, importer);

    await expect(Promise.all([first, second])).resolves.toEqual([definition, definition]);
    expect(importer).toHaveBeenCalledOnce();
  });

  it('reports a missing entry point import and permits retry', async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValueOnce({ default: createDefinition() });

    await expect(loadExternalPanelDefinition(manifest, importer)).rejects.toMatchObject({
      code: 'import-failed',
    });
    await expect(loadExternalPanelDefinition(manifest, importer)).resolves.toBeDefined();
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid exports, mismatched IDs, and mismatched API versions', async () => {
    await expect(loadExternalPanelDefinition(manifest, vi.fn().mockResolvedValue({}))).rejects.toMatchObject({
      code: 'invalid-module',
    });
    await expect(
      loadExternalPanelDefinition(
        manifest,
        vi.fn().mockResolvedValue({ default: createDefinition({ id: 'wrong.id' }) })
      )
    ).rejects.toMatchObject({ code: 'definition-mismatch' });
    await expect(
      loadExternalPanelDefinition(
        { ...manifest, version: '1.0.1' },
        vi.fn().mockResolvedValue({ default: createDefinition({ apiVersion: '2.0.0' }) })
      )
    ).rejects.toMatchObject({ code: 'definition-mismatch' });
  });

  it('accepts a compatible module API patch version', async () => {
    const definition = createDefinition({ apiVersion: '1.0.0' });
    await expect(
      loadExternalPanelDefinition(manifest, vi.fn().mockResolvedValue({ default: definition }))
    ).resolves.toBe(definition);
  });
});
