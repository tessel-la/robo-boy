import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizablePanels } from './useResizablePanels';

describe('useResizablePanels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('should initialize with default height', () => {
        const { result } = renderHook(() => useResizablePanels());
        expect(result.current.topHeight).toBe(60);
        expect(result.current.bottomHeight).toBe(40);
    });

    it('should initialize from local storage if valid', () => {
        localStorage.setItem('test-key', '75');
        const { result } = renderHook(() => useResizablePanels({ storageKey: 'test-key' }));
        expect(result.current.topHeight).toBe(75);
    });

    it('should ignore invalid local storage values', () => {
        localStorage.setItem('test-key', 'invalid');
        const { result } = renderHook(() => useResizablePanels({ storageKey: 'test-key' }));
        expect(result.current.topHeight).toBe(60); // Default
    });

    it('should update height on mouse move', () => {
        const { result } = renderHook(() => useResizablePanels());

        // Setup container ref
        const containerMock = document.createElement('div');
        vi.spyOn(containerMock, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            height: 1000,
            width: 100,
            left: 0,
            right: 100,
            bottom: 1000,
            x: 0,
            y: 0,
            toJSON: () => { }
        });
        // Set current manually since we can't mount easily in hook test
        (result.current.containerRef as any).current = containerMock;

        // Start drag
        act(() => {
            result.current.handleMouseDown({ preventDefault: vi.fn() } as any);
        });

        expect(result.current.isDragging).toBe(true);

        // Move mouse to 50%
        act(() => {
            const moveEvent = new MouseEvent('mousemove', { clientY: 500 });
            document.dispatchEvent(moveEvent);
        });

        expect(result.current.topHeight).toBe(50);
    });

    it('should respect constraints', () => {
        const { result } = renderHook(() => useResizablePanels({
            minTopHeight: 20,
            minBottomHeight: 20
        }));

        const containerMock = document.createElement('div');
        vi.spyOn(containerMock, 'getBoundingClientRect').mockReturnValue({
            top: 0,
            height: 1000,
            width: 100,
            left: 0,
            right: 100,
            bottom: 1000,
            x: 0,
            y: 0,
            toJSON: () => { }
        });
        (result.current.containerRef as any).current = containerMock;

        act(() => {
            result.current.handleMouseDown({ preventDefault: vi.fn() } as any);
        });

        // Try to move to 10% (below min 20)
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100 }));
        });
        expect(result.current.topHeight).toBe(20);

        // Try to move to 90% (below bottom min 20 -> max top 80)
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientY: 900 }));
        });
        expect(result.current.topHeight).toBe(80);
    });

    it('should stop dragging on mouse up', () => {
        const { result } = renderHook(() => useResizablePanels());

        act(() => {
            result.current.handleMouseDown({ preventDefault: vi.fn() } as any);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            document.dispatchEvent(new Event('mouseup'));
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('should handle touch events', () => {
        const { result } = renderHook(() => useResizablePanels());

        // Setup container
        const containerMock = document.createElement('div');
        vi.spyOn(containerMock, 'getBoundingClientRect').mockReturnValue({
            top: 0, height: 1000, width: 100, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => { }
        });
        (result.current.containerRef as any).current = containerMock;

        act(() => {
            result.current.handleTouchStart({ preventDefault: vi.fn() } as any);
        });
        expect(result.current.isDragging).toBe(true);

        // Touch move
        act(() => {
            const touchEvent = new TouchEvent('touchmove', {
                touches: [{ clientY: 300 } as any]
            });
            document.dispatchEvent(touchEvent);
        });
        expect(result.current.topHeight).toBe(30);

        // Touch end
        act(() => {
            document.dispatchEvent(new Event('touchend'));
        });
        expect(result.current.isDragging).toBe(false);
    });
});
