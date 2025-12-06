import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizablePanels } from './useResizablePanels';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
    };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useResizablePanels', () => {
    beforeEach(() => {
        localStorageMock.clear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('should return default values when no options provided', () => {
            const { result } = renderHook(() => useResizablePanels());

            expect(result.current.topHeight).toBe(60);
            expect(result.current.bottomHeight).toBe(40);
            expect(result.current.isDragging).toBe(false);
        });

        it('should use custom initialTopHeight', () => {
            const { result } = renderHook(() =>
                useResizablePanels({ initialTopHeight: 70 })
            );

            expect(result.current.topHeight).toBe(70);
            expect(result.current.bottomHeight).toBe(30);
        });

        it('should load from localStorage when storageKey provided', () => {
            localStorageMock.setItem('test-key', '50');
            localStorageMock.getItem.mockReturnValue('50');

            const { result } = renderHook(() =>
                useResizablePanels({ storageKey: 'test-key' })
            );

            expect(result.current.topHeight).toBe(50);
        });

        it('should use initialTopHeight when localStorage value is invalid', () => {
            localStorageMock.getItem.mockReturnValue('invalid');

            const { result } = renderHook(() =>
                useResizablePanels({ storageKey: 'test-key', initialTopHeight: 60 })
            );

            expect(result.current.topHeight).toBe(60);
        });

        it('should use initialTopHeight when localStorage value is below minTopHeight', () => {
            localStorageMock.getItem.mockReturnValue('10');

            const { result } = renderHook(() =>
                useResizablePanels({
                    storageKey: 'test-key',
                    initialTopHeight: 60,
                    minTopHeight: 20,
                })
            );

            expect(result.current.topHeight).toBe(60);
        });

        it('should use initialTopHeight when localStorage value exceeds max', () => {
            localStorageMock.getItem.mockReturnValue('95');

            const { result } = renderHook(() =>
                useResizablePanels({
                    storageKey: 'test-key',
                    initialTopHeight: 60,
                    minBottomHeight: 20,
                })
            );

            expect(result.current.topHeight).toBe(60);
        });
    });

    describe('localStorage persistence', () => {
        it('should save to localStorage when topHeight changes', () => {
            localStorageMock.getItem.mockReturnValue(null);

            renderHook(() =>
                useResizablePanels({ storageKey: 'persist-key' })
            );

            expect(localStorageMock.setItem).toHaveBeenCalledWith('persist-key', '60');
        });
    });

    describe('event handlers', () => {
        it('should provide handleMouseDown function', () => {
            const { result } = renderHook(() => useResizablePanels());

            expect(typeof result.current.handleMouseDown).toBe('function');
        });

        it('should provide handleTouchStart function', () => {
            const { result } = renderHook(() => useResizablePanels());

            expect(typeof result.current.handleTouchStart).toBe('function');
        });

        it('should set isDragging to true on mouse down', () => {
            const { result } = renderHook(() => useResizablePanels());

            act(() => {
                const mockEvent = {
                    preventDefault: vi.fn(),
                } as unknown as React.MouseEvent;
                result.current.handleMouseDown(mockEvent);
            });

            expect(result.current.isDragging).toBe(true);
        });

        it('should set isDragging to true on touch start', () => {
            const { result } = renderHook(() => useResizablePanels());

            act(() => {
                const mockEvent = {
                    preventDefault: vi.fn(),
                } as unknown as React.TouchEvent;
                result.current.handleTouchStart(mockEvent);
            });

            expect(result.current.isDragging).toBe(true);
        });
    });

    describe('containerRef', () => {
        it('should provide a containerRef', () => {
            const { result } = renderHook(() => useResizablePanels());

            expect(result.current.containerRef).toBeDefined();
            expect(result.current.containerRef.current).toBeNull();
        });
    });

    describe('computed values', () => {
        it('should correctly compute bottomHeight', () => {
            const { result } = renderHook(() =>
                useResizablePanels({ initialTopHeight: 30 })
            );

            expect(result.current.topHeight).toBe(30);
            expect(result.current.bottomHeight).toBe(70);
        });

        it('should maintain sum of 100 for topHeight and bottomHeight', () => {
            const { result } = renderHook(() =>
                useResizablePanels({ initialTopHeight: 45 })
            );

            expect(result.current.topHeight + result.current.bottomHeight).toBe(100);
        });
    });

    describe('cleanup', () => {
        it('should add and remove event listeners on mount/unmount', () => {
            const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
            const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

            const { unmount } = renderHook(() => useResizablePanels());

            // Should add listeners on mount
            expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
            expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
            expect(addEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false });
            expect(addEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
            expect(addEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));

            unmount();

            // Should remove listeners on unmount
            expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
            expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
            expect(removeEventListenerSpy).toHaveBeenCalledWith('touchmove', expect.any(Function));
            expect(removeEventListenerSpy).toHaveBeenCalledWith('touchend', expect.any(Function));
            expect(removeEventListenerSpy).toHaveBeenCalledWith('touchcancel', expect.any(Function));
        });
    });
});
