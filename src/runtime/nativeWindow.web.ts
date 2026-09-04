/**
 * Stands in for Tauri's window API outside the packaged shell.
 *
 * Web builds resolve this module instead of `@tauri-apps/api/window` (see the alias in
 * config/vite.config.ts and the path mapping in tsconfig.json), so running or type-checking the
 * web app never requires the desktop-only package. A browser draws its own window chrome, so the
 * app's title bar never renders there and nothing reaches this module.
 */
export const getCurrentWindow = (): never => {
  throw new Error('The native window is only available in the desktop app.');
};
