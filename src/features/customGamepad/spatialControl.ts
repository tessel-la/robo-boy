import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { GamepadComponentConfig } from './types';

/** The mounted control owns commands; another view can invoke its existing handlers. */
export interface PadSpatialControl {
  drag?: boolean;
  start?(x: number, y: number): void;
  move?(x: number, y: number): void;
  end?(): void;
  activate?(): void;
}

const controls = new WeakMap<HTMLElement, PadSpatialControl>();

export function usePadSpatialControl(
  element: RefObject<HTMLElement>,
  handlers: PadSpatialControl,
  disabled: boolean,
  configuration: GamepadComponentConfig
): void {
  const lifetime = JSON.stringify(configuration);
  const latest = useRef(handlers);
  latest.current = handlers;
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || disabled) return;
    let held = false;
    let endHeld: PadSpatialControl['end'];
    const control: PadSpatialControl = {
      get drag() {
        return latest.current.drag;
      },
      start: (x, y) => {
        held = true;
        endHeld = latest.current.end;
        latest.current.start?.(x, y);
      },
      move: (x, y) => latest.current.move?.(x, y),
      end: () => {
        if (held) {
          held = false;
          endHeld?.();
        }
      },
      activate: () => latest.current.activate?.(),
    };
    controls.set(node, control);
    return () => {
      control.end?.();
      controls.delete(node);
    };
  }, [element, disabled, lifetime]);
}

export function getPadSpatialControl(element: HTMLElement): PadSpatialControl | null {
  return controls.get(element) ?? null;
}
