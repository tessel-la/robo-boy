import type { Vector2 } from 'three';

/** Resolve one painted DOM target; never broadcast a command to overlapping descendants. */
export function findDomTarget(root: HTMLElement, uv: Vector2): HTMLElement | null {
  if (!root.isConnected) return null;
  const rect = root.getBoundingClientRect();
  const x = rect.left + uv.x * rect.width;
  const y = rect.top + (1 - uv.y) * rect.height;
  const target = root.ownerDocument.elementFromPoint(x, y);
  if (!(target instanceof HTMLElement) || !root.contains(target)) return null;
  if (target.closest(':disabled, [aria-disabled="true"], [inert]')) return null;
  return target.closest<HTMLElement>('button, input, a, [role="button"]') ?? target;
}

/** Discrete clicks only. Continuous robot controls need a native XR press/release contract. */
export function activateDomTarget(root: HTMLElement, uv: Vector2): void {
  const target = findDomTarget(root, uv);
  if (!target || !root.contains(target)) return;
  const rect = root.getBoundingClientRect();
  target.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + uv.x * rect.width,
    clientY: rect.top + (1 - uv.y) * rect.height,
  }));
}
