import type { DesktopWindow, ResizeDirection } from './desktopWindow';

/**
 * The Electron shell's view of itself, as its preload script exposes it.
 *
 * Declared here rather than imported from the shell: the renderer is built on its own and must
 * type-check without the desktop packages present, exactly as it does for Tauri's window API.
 */
/**
 * A fetched panel asset as it crosses the context bridge.
 *
 * Only structured-cloneable values make the trip, so the shell sends the parts of a response
 * rather than a Response, and {@link toResponse} puts one back together on this side.
 */
export interface PanelFetchReply {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface RoboBoyDesktopBridge {
  shell: 'electron';
  window: DesktopWindow;
  fetchPanelAsset(url: string, init?: { method?: string }): Promise<PanelFetchReply>;
}

/** Statuses the Response constructor refuses to pair with a body. */
const BODILESS_STATUSES = new Set([101, 103, 204, 205, 304]);

export const toResponse = (reply: PanelFetchReply): Response =>
  new Response(BODILESS_STATUSES.has(reply.status) ? null : reply.body, {
    status: reply.status,
    statusText: reply.statusText,
    headers: reply.headers,
  });

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
