import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PointerEvent } from 'react';
import { useOverlayFrame } from './useOverlayFrame';
import type { OverlayFrame } from '../utils/jointStates';
let resized: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
const container = () => {
  const current = document.createElement('div');
  Object.defineProperties(current, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 600 },
  });
  return { current };
};
function pointer(target: HTMLElement, extra = {}) {
  return {
    currentTarget: target,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...extra,
  } as unknown as PointerEvent<HTMLElement>;
}
const handle = () =>
  Object.assign(document.createElement('button'), {
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  });
it('previews a bounded drag, saves only on completion and responds to panel resizing', () => {
  const parent = container(),
    save = vi.fn(),
    target = handle();
  const { result, rerender, unmount } = renderHook(
    ({ saved }: { saved?: OverlayFrame }) => useOverlayFrame(parent, saved, save),
    { initialProps: {} }
  );
  act(() => result.current.start(pointer(target, { button: 1 }), false));
  expect(target.setPointerCapture).not.toHaveBeenCalled();
  act(() => result.current.move(pointer(target)));
  act(() => result.current.start(pointer(target), false));
  act(() => result.current.move(pointer(target, { pointerId: 2, clientX: 200 })));
  expect(result.current.frame.left).toBe(468);
  act(() => result.current.move(pointer(target, { clientX: -900, clientY: 900 })));
  expect(result.current.frame).toMatchObject({ left: 8, top: 292 });
  expect(save).not.toHaveBeenCalled();
  act(() => result.current.end(pointer(target, { pointerId: 2 })));
  expect(save).not.toHaveBeenCalled();
  act(() => result.current.end(pointer(target)));
  expect(save).toHaveBeenCalledWith({ left: 8, top: 292, width: 320, height: 300 });
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
  rerender({ saved: save.mock.calls[0][0] });
  Object.defineProperty(parent.current, 'clientWidth', { value: 200 });
  act(() => resized());
  expect(result.current.frame.width).toBe(184);
  expect(result.current.frame.left).toBe(8);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
it('bounds pointer resizing and releases capture if unmounted during a gesture', () => {
  const parent = container(),
    save = vi.fn(),
    target = handle();
  const { result, unmount } = renderHook(() => useOverlayFrame(parent, undefined, save));
  act(() => result.current.start(pointer(target), true));
  act(() => result.current.move(pointer(target, { clientX: 100, clientY: -1000 })));
  expect(result.current.frame).toMatchObject({ width: 420, height: 140 });
  act(() => result.current.end(pointer(target)));
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ width: 420, height: 140 }));
  act(() => result.current.change({ left: -10, top: -10, width: 4000, height: 4000 }));
  expect(save).toHaveBeenLastCalledWith({ left: 8, top: 8, width: 784, height: 584 });
  act(() => result.current.start(pointer(target), false));
  unmount();
  expect(target.releasePointerCapture).toHaveBeenCalledTimes(2);
});
