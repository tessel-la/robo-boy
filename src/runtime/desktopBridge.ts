import type { DesktopWindow, ResizeDirection } from './desktopWindow';

/**
 * The Electron shell's view of itself, as its preload script exposes it.
 *
 * Declared here rather than imported from the shell: the renderer is built on its own and must
 * type-check without the desktop packages present, exactly as it does for Tauri's window API.
 */
export interface RoboBoyDesktopBridge {
  shell: 'electron';
  window: DesktopWindow;
  fetchPanelAsset(url: string, init?: { method?: string }): Promise<Response>;
}

type BridgeCarrier = typeof globalThis & { roboBoyDesktop?: RoboBoyDesktopBridge };

/**
 * The Electron bridge, or undefined under any other shell.
 *
 * Every caller checks for it rather than assuming a shell, because the same renderer is served
 * three ways: in a browser, inside Tauri's web view, and here.
 */
export const getDesktopBridge = (): RoboBoyDesktopBridge | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as BridgeCarrier).roboBoyDesktop;
};

export const isElectronRuntime = (): boolean => getDesktopBridge() !== undefined;

export type { DesktopWindow, ResizeDirection };
