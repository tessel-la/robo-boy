import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultAssistantFrame, useFloatingFrame } from './useFloatingFrame';

const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Event(type, { bubbles: true }), { clientX: x, clientY: y, pointerId: 1, button: 0, ...extra });

describe('useFloatingFrame', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('docks to the right under the app bar until it is moved', () => {
    const { result } = renderHook(() => useFloatingFrame(true));
    expect(result.current.frame).toEqual(defaultAssistantFrame());
    expect(result.current.frame!.left + result.current.frame!.width).toBe(1280);
    expect(result.current.frame!.top).toBe(48);
  });

  it('is inert on compact layouts', () => {
    const { result } = renderHook(() => useFloatingFrame(false));
    expect(result.current.frame).toBeNull();
  });

  it('moves with a header drag, resizes from an edge, clamps to the viewport, and remembers the frame', () => {
    const { result } = renderHook(() => useFloatingFrame(true));
    const handle = document.createElement('div');
    const start = result.current.frame!;

    act(() => {
      result.current.startGesture({ ...pointer('pointerdown', 900, 100), currentTarget: handle, preventDefault() {} } as never, 'move');
    });
    act(() => { handle.dispatchEvent(pointer('pointermove', 700, 80)); });
    expect(result.current.frame).toMatchObject({ left: start.left - 200, top: start.top - 20 });
    act(() => { handle.dispatchEvent(pointer('pointerup', 700, 80)); });

    act(() => {
      result.current.startGesture({ ...pointer('pointerdown', 700, 400), currentTarget: handle, preventDefault() {} } as never, 'w');
    });
    act(() => { handle.dispatchEvent(pointer('pointermove', 600, 400)); });
    expect(result.current.frame!.width).toBe(start.width + 100);
    act(() => { handle.dispatchEvent(pointer('pointerup', 600, 400)); });

    // Dragged far off screen, the frame stays within the viewport margin.
    act(() => {
      result.current.startGesture({ ...pointer('pointerdown', 0, 0), currentTarget: handle, preventDefault() {} } as never, 'move');
    });
    act(() => { handle.dispatchEvent(pointer('pointermove', -5000, -5000)); });
    expect(result.current.frame).toMatchObject({ left: 8, top: 0 });
    act(() => { handle.dispatchEvent(pointer('pointerup', -5000, -5000)); });

    const remembered = JSON.parse(localStorage.getItem('robo-boy-assistant-frame-v1')!);
    expect(remembered).toEqual(result.current.frame);
    const { result: again } = renderHook(() => useFloatingFrame(true));
    expect(again.current.frame).toEqual(remembered);

    act(() => again.current.reset());
    expect(again.current.frame).toEqual(defaultAssistantFrame());
    expect(localStorage.getItem('robo-boy-assistant-frame-v1')).toBeNull();
  });
});
