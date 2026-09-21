import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getDesktopBridge } from '../runtime/desktopBridge';

/**
 * Transport for panel installation in the packaged app.
 *
 * The official inventory publishes manifests and bundles as GitHub release assets, which serve no
 * CORS headers, so the renderer cannot fetch them at all -- only the catalog and inventory entries
 * on raw.githubusercontent.com are reachable. Both desktop shells perform these requests outside
 * the renderer's CORS enforcement and both limit themselves to the hosts the inventory publishes
 * from: Tauri through its HTTP capability scope, Electron in its main process.
 *
 * This changes only how bytes arrive. They are still checked against the origins the source
 * allows and against the SHA-256 published in both the inventory entry and the manifest, so the
 * transport is granted no additional trust.
 */
export const panelInstallFetch: typeof fetch = (input, init) => {
  const bridge = getDesktopBridge();
  if (bridge) {
    return bridge.fetchPanelAsset(String(input instanceof Request ? input.url : input), {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    });
  }

  return (tauriFetch as unknown as typeof fetch)(input, init);
};
