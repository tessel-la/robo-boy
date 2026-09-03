import type { Window } from '@tauri-apps/api/window';

/**
 * Reaches the native window the app is drawn in.
 *
 * The window API only exists inside the desktop shell, so it is loaded on demand: the browser
 * build resolves this module but never pulls the Tauri code into its bundle. Call it only when
 * `isDesktopRuntime()` holds.
 */
export const getDesktopWindow = async (): Promise<Window> => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
};
