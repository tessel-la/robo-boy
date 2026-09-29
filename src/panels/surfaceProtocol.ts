/** Private host/sandbox transport, not a change to the external panel SDK. */
export interface PanelSurfaceTarget {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PanelSurfaceFrame {
  type: 'surface-frame';
  requestId: number;
  image?: ImageBitmap;
  targets: PanelSurfaceTarget[];
  error?: string;
}
export type PanelSurfaceInput =
  | {
      type: 'surface-input';
      action: 'down' | 'up' | 'cancel' | 'click' | 'move';
      pointerId: string;
      targetId: string;
      x: number;
      y: number;
    }
  | { type: 'surface-scroll'; delta: number }
  | { type: 'surface-stop' };

export function validSurfaceFrame(value: PanelSurfaceFrame): boolean {
  return (
    Number.isSafeInteger(value.requestId) &&
    value.requestId > 0 &&
    (value.image === undefined ||
      (typeof ImageBitmap !== 'undefined' &&
        value.image instanceof ImageBitmap &&
        value.image.width > 0 &&
        value.image.height > 0 &&
        value.image.width <= 1280 &&
        value.image.height <= 1280)) &&
    (value.error === undefined || (typeof value.error === 'string' && value.error.length <= 1024)) &&
    Array.isArray(value.targets) &&
    value.targets.length <= 512 &&
    value.targets.every(
      t =>
        t &&
        typeof t.id === 'string' &&
        /^target-\d{1,8}$/.test(t.id) &&
        [t.x, t.y, t.width, t.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) &&
        t.width > 0 &&
        t.height > 0 &&
        t.x + t.width <= 1.000001 &&
        t.y + t.height <= 1.000001
    ) &&
    new Set(value.targets.map(t => t.id)).size === value.targets.length
  );
}
