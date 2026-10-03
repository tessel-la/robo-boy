import { ipcMain } from 'electron';

/** Hosts allowed by the official inventory and Tauri's HTTP capability. */
const PANEL_FETCH_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const isPanelFetchAllowed = (target: string): boolean => {
  try {
    const url = new URL(target);
    return url.protocol === 'https:' && !url.username && !url.password && PANEL_FETCH_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
};

/** Node's fetch verifies TLS independently of Chromium's robot certificate exceptions. */
export const fetchPanelAsset = async (target: string, init?: { method?: string }): Promise<Response> => {
  let method = init?.method ?? 'GET';
  for (let redirects = 0; redirects <= 20; redirects++) {
    if (!isPanelFetchAllowed(target)) {
      throw new Error(`Refusing to fetch a panel from an unlisted host: ${target}`);
    }
    const response = await fetch(target, { method, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status) || !response.headers.has('location')) return response;
    // Validate each redirect before following it: GitHub assets redirect to another listed host.
    await response.body?.cancel();
    target = new URL(response.headers.get('location')!, target).href;
    // Preserve fetch's method rewriting when following redirects manually.
    if ((response.status === 303 && method.toUpperCase() !== 'HEAD') ||
        ([301, 302].includes(response.status) && method.toUpperCase() === 'POST')) method = 'GET';
  }
  throw new Error('Too many panel download redirects.');
};

/** CORS-free downloads for the renderer; streams cannot cross the preload bridge. */
export const registerPanelFetch = (): void => {
  ipcMain.handle('roboboy:panel-fetch', async (_event, target: string, init?: { method?: string }) => {
    const response = await fetchPanelAsset(target, init);
    return {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.arrayBuffer(),
    };
  });
};
