import { fetch as nativeFetch } from '@tauri-apps/plugin-http';

/**
 * Transport for panel installation in the packaged app.
 *
 * The official inventory publishes manifests and bundles as GitHub release assets, which serve no
 * CORS headers, so the webview cannot fetch them at all -- only the catalog and inventory entries
 * on raw.githubusercontent.com are reachable. Tauri's HTTP client performs these requests
 * natively, outside the webview's CORS enforcement, and its capability scope limits it to the
 * hosts the inventory publishes from.
 *
 * This changes only how bytes arrive. They are still checked against the origins the source
 * allows and against the SHA-256 published in both the inventory entry and the manifest, so the
 * transport is granted no additional trust.
 */
export const panelInstallFetch = nativeFetch as unknown as typeof fetch;
