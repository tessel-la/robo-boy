import { afterEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: ipc }));
import { fetchPanelAsset, registerPanelFetch } from './panelFetch';

afterEach(() => vi.unstubAllGlobals());

describe('panel download transport', () => {
  const asset = 'https://github.com/tessel-la/panels/releases/download/v1/manifest.json';
  const mockFetch = () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('uses Node fetch and carries the response through the IPC bridge', async () => {
    const fetch = mockFetch().mockResolvedValue(new Response('bundle', {
      status: 200, headers: { 'content-type': 'text/javascript' },
    }));
    registerPanelFetch();
    const handler = ipc.handle.mock.calls.at(-1)![1];
    const reply = await handler({}, asset);
    expect(fetch).toHaveBeenCalledWith(asset, { method: 'GET', redirect: 'manual' });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/javascript');
    expect(Buffer.from(reply.body).toString()).toBe('bundle');
  });

  it('follows GitHub release asset redirects and preserves HEAD requests', async () => {
    const redirected = 'https://release-assets.githubusercontent.com/asset?token=signed';
    const response = new Response(null);
    const fetch = mockFetch()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: redirected } }))
      .mockResolvedValueOnce(response);
    expect(await fetchPanelAsset(asset, { method: 'HEAD' })).toBe(response);
    expect(fetch).toHaveBeenLastCalledWith(redirected, { method: 'HEAD', redirect: 'manual' });
  });

  it.each([[301, 'POST'], [302, 'POST'], [303, 'PUT']])
    ('preserves fetch method rewriting for %s redirects from %s', async (status, method) => {
      const fetch = mockFetch()
        .mockResolvedValueOnce(new Response(null, { status, headers: { location: '/asset' } }))
        .mockResolvedValueOnce(new Response('bundle'));
      await fetchPanelAsset(asset, { method });
      expect(fetch).toHaveBeenLastCalledWith('https://github.com/asset', { method: 'GET', redirect: 'manual' });
    });

  it.each([
    'http://github.com/asset', 'https://unlisted.example/asset', 'https://127.0.0.1/asset',
    'https://github.com.evil.example/asset', 'https://user:pw@github.com/asset', 'invalid',
  ])('refuses %s before making a request', async target => {
    const fetch = mockFetch();
    await expect(fetchPanelAsset(target)).rejects.toThrow('Refusing');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http://github.com/asset', 'https://robot.local/asset', 'https://evil.example/asset'])
    ('refuses a redirect to %s before following it', async location => {
      const response = new Response('redirect', { status: 302, headers: { location } });
      const fetch = mockFetch().mockResolvedValueOnce(response);
      await expect(fetchPanelAsset(asset)).rejects.toThrow('Refusing');
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(response.body!.locked).toBe(false);
      expect(response.bodyUsed).toBe(true);
    });

  it('resolves relative redirects and limits redirect loops', async () => {
    const fetch = mockFetch().mockImplementation(async () =>
      new Response(null, { status: 307, headers: { location: '/loop' } }));
    await expect(fetchPanelAsset(asset)).rejects.toThrow('Too many');
    expect(fetch).toHaveBeenCalledTimes(21);
    expect(fetch).toHaveBeenLastCalledWith('https://github.com/loop', { method: 'GET', redirect: 'manual' });
  });

  it('propagates TLS errors without retrying with relaxed verification', async () => {
    const error = new TypeError('fetch failed', { cause: new Error('self-signed certificate') });
    const fetch = mockFetch().mockRejectedValue(error);
    await expect(fetchPanelAsset(asset)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
