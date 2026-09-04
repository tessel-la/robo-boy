/** The edges a window can be dragged by, named as the native window API names them. */
export type ResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

/**
 * What the app's own window chrome needs of the window it is drawn in.
 *
 * Stated here rather than imported, because web builds resolve the native module to a stub and
 * would otherwise have no types to check these calls against.
 */
export interface DesktopWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
}

/**
 * Reaches the native window the app is drawn in.
 *
 * The window API only exists inside the desktop shell, so it is loaded on demand and the browser
 * build resolves a stub in its place. Call this only when `isDesktopRuntime()` holds.
 */
export const getDesktopWindow = async (): Promise<DesktopWindow> => {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
};
