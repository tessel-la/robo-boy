/**
 * Stands in for Tauri's HTTP client outside the packaged shell.
 *
 * Web builds resolve this module instead of `@tauri-apps/plugin-http` (see the alias in
 * config/vite.config.ts and the path mapping in tsconfig.json), so running or type-checking the
 * web app never requires the desktop-only package. The web app installs panels through the
 * deployment's manager service and never reaches this transport.
 */
export const fetch: typeof globalThis.fetch = () =>
  Promise.reject(new Error('Native HTTP panel installation is only available in the desktop app.'));
