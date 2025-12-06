import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Note: Testing useRos is challenging because it requires mocking ROSLIB.Ros constructor
// which doesn't work well with ES modules in vitest. These tests cover the basic contract.

describe('useRos', () => {
    beforeEach(() => {
        // Mock window.location
        Object.defineProperty(window, 'location', {
            value: {
                hostname: 'localhost',
                protocol: 'https:',
            },
            writable: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('should return null ros and disconnected state initially', async () => {
            // Dynamic import to avoid module loading issues
            const { useRos } = await import('./useRos');
            const { result } = renderHook(() => useRos());

            expect(result.current.ros).toBeNull();
            expect(result.current.isConnected).toBe(false);
        });

        it('should return connect and disconnect functions', async () => {
            const { useRos } = await import('./useRos');
            const { result } = renderHook(() => useRos());

            expect(typeof result.current.connect).toBe('function');
            expect(typeof result.current.disconnect).toBe('function');
        });

        it('should disconnect without error when not connected', async () => {
            const { useRos } = await import('./useRos');
            const { result } = renderHook(() => useRos());

            // Should not throw when disconnecting while not connected
            expect(() => {
                act(() => {
                    result.current.disconnect();
                });
            }).not.toThrow();

            expect(result.current.isConnected).toBe(false);
            expect(result.current.ros).toBeNull();
        });
    });

    describe('state management', () => {
        it('should maintain stable function references across renders', async () => {
            const { useRos } = await import('./useRos');
            const { result, rerender } = renderHook(() => useRos());

            const connectRef1 = result.current.connect;
            const disconnectRef1 = result.current.disconnect;

            rerender();

            expect(result.current.connect).toBe(connectRef1);
            expect(result.current.disconnect).toBe(disconnectRef1);
        });

        it('should remain disconnected if disconnect is called when not connected', async () => {
            const { useRos } = await import('./useRos');
            const { result } = renderHook(() => useRos());

            act(() => {
                result.current.disconnect();
            });

            expect(result.current.isConnected).toBe(false);
            expect(result.current.ros).toBeNull();
        });
    });

    describe('cleanup on unmount', () => {
        it('should not throw when unmounting without a connection', async () => {
            const { useRos } = await import('./useRos');
            const { unmount } = renderHook(() => useRos());

            // Should not throw
            expect(() => unmount()).not.toThrow();
        });
    });
});
