import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRos } from './useRos';
import ROSLIB from 'roslib';

// Mock ROSLIB
vi.mock('roslib', () => {
    const RosMock = vi.fn(function () {
        return {
            on: vi.fn(),
            close: vi.fn(),
            connect: vi.fn(),
        }
    });
    return {
        default: {
            Ros: RosMock
        },
        Ros: RosMock
    };
});

describe('useRos', () => {
    const mockParams = {
        ip: '192.168.1.10',
        port: 9090,
        ros2Option: 'domain' as const,
        ros2Value: '10'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Reset window location mock if needed
        Object.defineProperty(window, 'location', {
            value: {
                hostname: 'localhost',
                protocol: 'http:',
            },
            writable: true,
        });
    });

    it('should initialize with disconnected state', () => {
        const { result } = renderHook(() => useRos());
        expect(result.current.ros).toBeNull();
        expect(result.current.isConnected).toBe(false);
    });

    it('should attempt connection with correct URL', () => {
        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        expect(ROSLIB.Ros).toHaveBeenCalledWith({
            url: 'ws://localhost/websocket'
        });
    });

    it('should use wss for https protocol', () => {
        Object.defineProperty(window, 'location', {
            value: {
                hostname: 'robot.local',
                protocol: 'https:',
            },
            writable: true,
        });

        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        expect(ROSLIB.Ros).toHaveBeenCalledWith({
            url: 'wss://robot.local/websocket'
        });
    });

    it('should handle successful connection', () => {
        const onMock = vi.fn();
        (ROSLIB.Ros as any).mockImplementation(function () {
            return {
                on: onMock,
                close: vi.fn(),
            }
        });

        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        // Simulate 'connection' event
        const connectionCallback = onMock.mock.calls.find(call => call[0] === 'connection')?.[1];
        if (connectionCallback) {
            act(() => {
                connectionCallback();
            });
        }

        expect(result.current.isConnected).toBe(true);
        expect(result.current.ros).toBeTruthy();
    });

    it('should handle connection error', () => {
        const onMock = vi.fn();
        const closeMock = vi.fn();
        (ROSLIB.Ros as any).mockImplementation(function () {
            return {
                on: onMock,
                close: closeMock,
            }
        });

        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        // Simulate successful connection first to verified it gets reset
        const connectionCallback = onMock.mock.calls.find(call => call[0] === 'connection')?.[1];
        if (connectionCallback) {
            act(() => {
                connectionCallback();
            });
        }
        expect(result.current.isConnected).toBe(true);

        // Now simulate error
        const errorCallback = onMock.mock.calls.find(call => call[0] === 'error')?.[1];
        if (errorCallback) {
            act(() => {
                errorCallback(new Error('Connection failed'));
            });
        }

        expect(result.current.isConnected).toBe(false);
        expect(result.current.ros).toBeNull();
        expect(closeMock).toHaveBeenCalled();
    });

    it('should handle disconnect', () => {
        const closeMock = vi.fn();
        const onMock = vi.fn();
        (ROSLIB.Ros as any).mockImplementation(function () {
            return {
                on: onMock,
                close: closeMock,
            }
        });

        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        // Simulate 'connection'
        const connectionCallback = onMock.mock.calls.find(call => call[0] === 'connection')?.[1];
        if (connectionCallback) {
            act(() => {
                connectionCallback();
            });
        }

        act(() => {
            result.current.disconnect();
        });

        expect(closeMock).toHaveBeenCalled();
        expect(result.current.isConnected).toBe(false);
        expect(result.current.ros).toBeNull();
    });

    it('should prevent multiple connection attempts', () => {
        const { result } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
            result.current.connect(mockParams); // Second call
        });

        expect(ROSLIB.Ros).toHaveBeenCalledTimes(1);
    });

    it('should cleanup on unmount', () => {
        const closeMock = vi.fn();
        (ROSLIB.Ros as any).mockImplementation(function () {
            return {
                on: vi.fn(),
                close: closeMock,
            }
        });

        const { result, unmount } = renderHook(() => useRos());

        act(() => {
            result.current.connect(mockParams);
        });

        unmount();

        expect(closeMock).toHaveBeenCalled();
    });

});
