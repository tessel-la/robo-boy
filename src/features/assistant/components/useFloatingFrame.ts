import { useCallback, useEffect, useRef, useState } from 'react';

export interface FloatingFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const STORAGE_KEY = 'robo-boy-assistant-frame-v1';
const MIN_WIDTH = 360;
const MIN_HEIGHT = 320;
const MARGIN = 8;

const appBarHeight = () => {
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')) || 0;
  return 48 + safeTop;
};

/** Where the panel sits when nothing has been saved: docked to the right edge under the app bar,
 * which is the layout the panel had before it could float. */
export const defaultAssistantFrame = (): FloatingFrame => {
  const top = appBarHeight();
  const width = Math.min(Math.max(420, window.innerWidth * 0.32), 480, window.innerWidth - MARGIN * 2);
  return { left: window.innerWidth - width, top, width, height: window.innerHeight - top };
};

const clampFrame = (frame: FloatingFrame): FloatingFrame => {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - MARGIN * 2);
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - MARGIN);
  const width = Math.min(Math.max(frame.width, MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(frame.height, MIN_HEIGHT), maxHeight);
  return {
    width,
    height,
    left: Math.min(Math.max(frame.left, MARGIN), Math.max(MARGIN, window.innerWidth - width - MARGIN)),
    top: Math.min(Math.max(frame.top, 0), Math.max(0, window.innerHeight - height)),
  };
};

const readStoredFrame = (): FloatingFrame | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingFrame>;
    if ([parsed.left, parsed.top, parsed.width, parsed.height].every(value => typeof value === 'number' && Number.isFinite(value))) {
      return clampFrame(parsed as FloatingFrame);
    }
  } catch {
    // Ignore a corrupt entry; the default dock is always right.
  }
  return null;
};

const storeFrame = (frame: FloatingFrame | null) => {
  try {
    if (frame) localStorage.setItem(STORAGE_KEY, JSON.stringify(frame));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable; the position then lasts for the session only.
  }
};

/**
 * A draggable, resizable frame for the desktop assistant panel, remembered across sessions.
 * Pointer capture keeps a drag alive when the pointer crosses the canvas or an iframe; the frame
 * is clamped so the header can always be reached again after a viewport change.
 */
export const useFloatingFrame = (enabled: boolean) => {
  const [frame, setFrame] = useState<FloatingFrame | null>(() => (enabled ? readStoredFrame() : null));
  const [isDragging, setIsDragging] = useState(false);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const resolvedFrame = enabled ? frame ?? defaultAssistantFrame() : null;

  useEffect(() => {
    if (!enabled) return;
    const onResize = () => {
      if (frameRef.current) setFrame(clampFrame(frameRef.current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [enabled]);

  const startGesture = useCallback(
    (event: React.PointerEvent<HTMLElement>, edge: ResizeEdge | 'move') => {
      if (event.button !== 0) return;
      const start = { x: event.clientX, y: event.clientY };
      const origin = frameRef.current ?? defaultAssistantFrame();
      const target = event.currentTarget;
      target.setPointerCapture?.(event.pointerId);
      setIsDragging(true);
      let latest = origin;

      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - start.x;
        const dy = moveEvent.clientY - start.y;
        let next: FloatingFrame;
        if (edge === 'move') {
          next = { ...origin, left: origin.left + dx, top: origin.top + dy };
        } else {
          next = { ...origin };
          if (edge.includes('e')) next.width = origin.width + dx;
          if (edge.includes('s')) next.height = origin.height + dy;
          if (edge.includes('w')) {
            next.width = origin.width - dx;
            next.left = origin.left + Math.min(dx, origin.width - MIN_WIDTH);
          }
          if (edge.includes('n')) {
            next.height = origin.height - dy;
            next.top = origin.top + Math.min(dy, origin.height - MIN_HEIGHT);
          }
        }
        latest = clampFrame(next);
        setFrame(latest);
      };
      const onUp = () => {
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        target.releasePointerCapture?.(event.pointerId);
        setIsDragging(false);
        storeFrame(latest);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
      event.preventDefault();
    },
    []
  );

  const reset = useCallback(() => {
    setFrame(null);
    storeFrame(null);
  }, []);

  return { frame: resolvedFrame, isDragging, startGesture, reset };
};
