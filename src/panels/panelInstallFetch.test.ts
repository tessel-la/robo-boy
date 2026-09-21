import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { panelInstallFetch } from './panelInstallFetch';

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));

describe('panelInstallFetch', () => {
  const url = 'https://github.com/tessel-la/panels/releases/download/v1/manifest.json';
  const fetchPanelAsset = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const installBridge = () => {
    vi.stubGlobal('roboBoyDesktop', { shell: 'electron', fetchPanelAsset });
    fetchPanelAsset.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode('{"schemaVersion":1}').buffer,
    });
  };

  it.each([url, new URL(url)])('downloads a panel through Electron and rebuilds its response (%s)', async input => {
    installBridge();

    const response = await panelInstallFetch(input);

    expect(fetchPanelAsset).toHaveBeenCalledWith(url, { method: 'GET' });
    expect(tauriFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ schemaVersion: 1 });
  });

  it('uses a Request method, with an explicit init method taking precedence', async () => {
    installBridge();
    const request = new Request(url, { method: 'HEAD' });

    await panelInstallFetch(request);
    expect(fetchPanelAsset).toHaveBeenLastCalledWith(url, { method: 'HEAD' });

    await panelInstallFetch(request, { method: 'GET' });
    expect(fetchPanelAsset).toHaveBeenLastCalledWith(url, { method: 'GET' });
  });

  it('propagates a refused Electron download without retrying through another transport', async () => {
    installBridge();
    const error = new Error('Refusing to fetch a panel from an unlisted host');
    fetchPanelAsset.mockRejectedValue(error);

    await expect(panelInstallFetch('https://unlisted.example/panel.js')).rejects.toBe(error);
    expect(tauriFetch).not.toHaveBeenCalled();
  });

  it('preserves the original request and options for the non-Electron transport', async () => {
    const request = new Request(url);
    const init = { signal: new AbortController().signal, headers: { accept: 'application/json' } };
    const response = new Response('manifest');
    vi.mocked(tauriFetch).mockResolvedValue(response);

    await expect(panelInstallFetch(request, init)).resolves.toBe(response);
    expect(tauriFetch).toHaveBeenCalledWith(request, init);
    expect(fetchPanelAsset).not.toHaveBeenCalled();
  });
});
