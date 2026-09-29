import { capturePanelSurface } from './capturePanelSurface';
import type { PanelSurfaceFrame, PanelSurfaceInput, PanelSurfaceTarget } from './surfaceProtocol';

/** Capture and input run inside the opaque-origin sandbox; the host never gets DOM access. */
export function createSandboxSurface(send: (frame: PanelSurfaceFrame, transfer: Transferable[]) => void) {
  const ids = new WeakMap<Element, string>();
  const targets = new Map<string, HTMLElement>();
  const held = new Map<string, { target: HTMLElement; x: number; y: number; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0,
    generation = 0,
    capturing = false;
  const selector = 'button, input, select, textarea, a, [role="button"], [tabindex], canvas';
  const root = () => document.getElementById('panel-root');
  const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>(selector) ?? null;
  const dispatch = (target: HTMLElement, type: string, id: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: Number(id.replace(/\D/g, '')) + 100,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        clientX: x,
        clientY: y,
      })
    );
  const release = (id: string, cancel = true) => {
    const entry = held.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    held.delete(id);
    dispatch(
      entry.target.isConnected ? entry.target : document.body,
      cancel ? 'pointercancel' : 'pointerup',
      id,
      entry.x,
      entry.y
    );
  };
  const stop = () => {
    generation++;
    for (const id of held.keys()) release(id);
    targets.clear();
  };

  return {
    stop,
    async capture(requestId: number) {
      if (capturing || !Number.isSafeInteger(requestId) || requestId < 1) return;
      const element = root();
      if (!element || !element.clientWidth || !element.clientHeight) return;
      capturing = true;
      const currentGeneration = generation;
      try {
        const width = Math.min(4096, element.clientWidth),
          height = Math.min(4096, element.clientHeight);
        const rects: PanelSurfaceTarget[] = [];
        targets.clear();
        for (const target of element.querySelectorAll<HTMLElement>(selector)) {
          if (rects.length >= 512) break;
          const r = target.getBoundingClientRect();
          if (
            r.width <= 0 ||
            r.height <= 0 ||
            r.right <= 0 ||
            r.bottom <= 0 ||
            r.left >= width ||
            r.top >= height ||
            target.closest(':disabled, [aria-disabled="true"], [inert]')
          )
            continue;
          let id = ids.get(target);
          if (!id) {
            id = `target-${++sequence}`;
            ids.set(target, id);
          }
          targets.set(id, target);
          const x = Math.max(0, r.left),
            y = Math.max(0, r.top);
          rects.push({
            id,
            x: x / width,
            y: y / height,
            width: (Math.min(width, r.right) - x) / width,
            height: (Math.min(height, r.bottom) - y) / height,
          });
        }
        const canvas = await capturePanelSurface(element, width, height);
        const image = await createImageBitmap(canvas);
        if (currentGeneration !== generation) {
          image.close();
          return;
        }
        send({ type: 'surface-frame', requestId, image, targets: rects }, [image]);
      } catch (error) {
        if (currentGeneration === generation)
          send({ type: 'surface-frame', requestId, targets: [], error: String(error).slice(0, 1024) }, []);
      } finally {
        capturing = false;
      }
    },
    input(message: PanelSurfaceInput) {
      if (message.type === 'surface-stop') {
        stop();
        return;
      }
      const element = root();
      if (!element) return;
      if (message.type === 'surface-scroll') {
        if (!Number.isFinite(message.delta)) return;
        const scrollable = [element, ...element.querySelectorAll<HTMLElement>('*')].find(
          el => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)
        );
        if (scrollable)
          scrollable.scrollTop += Math.max(-1, Math.min(1, message.delta)) * scrollable.clientHeight * 0.7;
        return;
      }
      const { pointerId: id, action } = message;
      if (typeof id !== 'string' || id.length > 80) return;
      if (action === 'cancel') {
        release(id);
        return;
      }
      if (action === 'up') {
        release(id, false);
        return;
      }
      if (![message.x, message.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return;
      const x = message.x * element.clientWidth,
        y = message.y * element.clientHeight;
      const target = targets.get(message.targetId);
      if (
        !target ||
        !target.isConnected ||
        targetAt(x, y) !== target ||
        target.closest(':disabled, [aria-disabled="true"], [inert]')
      ) {
        release(id);
        return;
      }
      if (action === 'down') {
        release(id);
        if (held.size >= 2) return;
        target.focus({ preventScroll: true });
        const timer = setTimeout(() => release(id), 400);
        held.set(id, { target, x, y, timer });
        dispatch(target, 'pointerdown', id, x, y);
      } else if (action === 'move') {
        const entry = held.get(id);
        if (!entry) return;
        if (entry.target !== target) {
          release(id);
          return;
        }
        clearTimeout(entry.timer);
        entry.x = x;
        entry.y = y;
        entry.timer = setTimeout(() => release(id), 400);
        dispatch(target, 'pointermove', id, x, y);
      } else if (action === 'click') target.click();
    },
  };
}
