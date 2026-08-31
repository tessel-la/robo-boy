import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadVerifiedExternalPanelSource } from './loader';
import type { ResolvedPanelManifest } from './types';

const source = 'export default {};\n';
const manifest: ResolvedPanelManifest = {
  schemaVersion: 1,
  id: 'com.example.panel',
  name: 'Example panel',
  description: 'An example.',
  version: '2.0.0',
  entryPoint: 'https://roboboy.test/panels/example/2.0.0/index.js',
  integrity: 'sha256-RQ8K9PTB7MTHGA8uNkyKWb/tad01D7a0e86GQcKjd4Y=',
  registryUrl: 'https://roboboy.test/panels/installed.json',
  compatibility: { panelApi: '^2.0.0', roboboy: '*' },
  capabilities: [],
  author: { name: 'Example' },
  repository: 'https://github.com/example/panel',
};

const responseFor = (body: Uint8Array) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(body.byteLength) }),
    arrayBuffer: () => Promise.resolve(body.buffer),
  }) as Response;

describe('external panel source loader', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns integrity-verified source without sending ambient credentials', async () => {
    const bytes = new TextEncoder().encode(source);
    const fetcher = vi.fn().mockResolvedValue(responseFor(bytes));

    await expect(loadVerifiedExternalPanelSource(manifest, fetcher)).resolves.toBe(source);
    expect(fetcher).toHaveBeenCalledWith(manifest.entryPoint, { cache: 'no-cache', credentials: 'omit' });
  });

  it('rejects changed bundle bytes', async () => {
    const fetcher = vi.fn().mockResolvedValue(responseFor(new TextEncoder().encode('changed')));
    await expect(loadVerifiedExternalPanelSource(manifest, fetcher)).rejects.toMatchObject({
      code: 'integrity-failed',
    });
  });

  it('reports fetch failures without importing code in the parent page', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(loadVerifiedExternalPanelSource(manifest, fetcher)).rejects.toMatchObject({
      code: 'fetch-failed',
      message: expect.stringContaining('offline'),
    });
  });
});
