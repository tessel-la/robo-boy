import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThreePanelLayout } from './useThreePanelLayout';

const createMouseEvent = () => ({ preventDefault: vi.fn() }) as any;
const createTouchEvent = (clientY = 0) => ({
  preventDefault: vi.fn(),
  touches: [{ clientY }],
}) as any;

describe('useThreePanelLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  it('loads valid stored heights and persists updates', () => {
    localStorage.setItem('panels', JSON.stringify({ bt: 25, view: 50, control: 25 }));

    const { result } = renderHook(() => useThreePanelLayout({ storageKey: 'panels' }));

    expect(result.current.btHeight).toBe(25);
    expect(result.current.viewHeight).toBe(50);
    expect(result.current.controlHeight).toBe(25);
    expect(localStorage.getItem('panels')).toBe(JSON.stringify({ bt: 25, view: 50, control: 25 }));
  });

  it('falls back when stored heights are invalid', () => {
    localStorage.setItem('panels', JSON.stringify({ bt: 90, view: 5, control: 5 }));

    const { result } = renderHook(() =>
      useThreePanelLayout({ initialBtHeight: 30, initialViewHeight: 45, minPanelHeight: 15, storageKey: 'panels' })
    );

    expect(result.current.btHeight).toBe(30);
    expect(result.current.viewHeight).toBe(45);
    expect(result.current.controlHeight).toBe(25);
  });

  it('resizes the behavior tree panel with pointer movement', () => {
    const { result } = renderHook(() => useThreePanelLayout({ minPanelHeight: 15 }));
    const container = document.createElement('div');
    container.getBoundingClientRect = vi.fn(() => ({
      top: 100,
      left: 0,
      width: 400,
      height: 500,
      right: 400,
      bottom: 600,
      x: 0,
      y: 100,
      toJSON: () => {},
    }));

    act(() => {
      (result.current.containerRef as any).current = container;
      result.current.handleBtViewMouseDown(createMouseEvent());
    });

    expect(result.current.activeHandle).toBe('bt-view');
    expect(document.body.style.cursor).toBe('row-resize');

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientY: 300 }));
    });

    expect(result.current.btHeight).toBe(40);
    expect(result.current.viewHeight).toBe(40);
    expect(result.current.controlHeight).toBe(20);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.isDragging).toBe(false);
    expect(document.body.style.cursor).toBe('');
  });

  it('supports touch resizing for the view/control divider', () => {
    const { result } = renderHook(() => useThreePanelLayout({ initialBtHeight: 30, initialViewHeight: 40 }));
    const container = document.createElement('div');
    container.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      width: 300,
      height: 400,
      right: 300,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));

    act(() => {
      (result.current.containerRef as any).current = container;
      result.current.handleViewControlTouchStart(createTouchEvent());
    });

    act(() => {
      const touchMove = new Event('touchmove') as TouchEvent;
      Object.defineProperty(touchMove, 'touches', {
        value: [{ clientY: 260 }],
      });
      document.dispatchEvent(touchMove);
    });

    expect(result.current.btHeight).toBe(30);
    expect(result.current.viewHeight).toBe(35);
    expect(result.current.controlHeight).toBe(35);
  });
});
