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
    };
  });
  return {
    default: {
      Ros: RosMock,
    },
    Ros: RosMock,
  };
});

describe('useRos', () => {
  const mockParams = {
    ip: '192.168.1.10',
    port: 9090,
    ros2Option: 'domain' as const,
    ros2Value: '10',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as Window & { ros?: unknown }).ros;
    // Reset window location mock if needed
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'localhost',
        protocol: 'http:',
      },
      writable: true,
    });
  });

  afterEach(() => vi.useRealTimers());

  it('should initialize with disconnected state', () => {
    const { result } = renderHook(() => useRos());
    expect(result.current.ros).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionStatus).toBe('disconnected');
    expect((window as Window & { ros?: unknown }).ros).toBeUndefined();
  });

  it('should attempt connection with correct URL', () => {
    const { result } = renderHook(() => useRos());

    act(() => {
      result.current.connect(mockParams);
    });

    expect(ROSLIB.Ros).toHaveBeenCalledWith({
      url: 'ws://localhost/websocket',
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
      url: 'wss://robot.local/websocket',
    });
  });

  it('should preserve a non-default web port', () => {
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'robot.local',
        host: 'robot.local:8443',
        protocol: 'https:',
      },
      writable: true,
    });

    const { result } = renderHook(() => useRos());
    act(() => result.current.connect(mockParams));

    expect(ROSLIB.Ros).toHaveBeenCalledWith({
      url: 'wss://robot.local:8443/websocket',
    });
  });

  it('should use the advanced host value as a direct web backend host', () => {
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'operator.local',
        host: 'operator.local',
        protocol: 'http:',
      },
      writable: true,
    });

    const { result } = renderHook(() => useRos());
    act(() => result.current.connect({ ros2Option: 'ip', ros2Value: 'robot.tailnet.ts.net' }));

    expect(ROSLIB.Ros).toHaveBeenCalledWith({
      url: 'ws://robot.tailnet.ts.net:9090',
    });
  });

  it('should handle successful connection', () => {
    const onMock = vi.fn();
    (ROSLIB.Ros as any).mockImplementation(function () {
      return {
        on: onMock,
        close: vi.fn(),
      };
    });

    const { result } = renderHook(() => useRos());

    act(() => {
      result.current.connect(mockParams);
    });
    const connect = result.current.connect;

    // Simulate 'connection' event
    const connectionCallback = onMock.mock.calls.find(call => call[0] === 'connection')?.[1];
    if (connectionCallback) {
      act(() => {
        connectionCallback();
      });
    }

    expect(result.current.isConnected).toBe(true);
    expect(result.current.ros).toBeTruthy();
    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.connectionGeneration).toBe(1);
    expect((window as Window & { ros?: unknown }).ros).toBeUndefined();
    expect(result.current.connect).toBe(connect);
  });

  it('should handle connection error', () => {
    const onMock = vi.fn();
    const closeMock = vi.fn();
    (ROSLIB.Ros as any).mockImplementation(function () {
      return {
        on: onMock,
        close: closeMock,
      };
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
      };
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
    const offMock = vi.fn();
    (ROSLIB.Ros as any).mockImplementation(function () {
      return {
        on: vi.fn(),
        off: offMock,
        close: closeMock,
      };
    });

    const { result, unmount } = renderHook(() => useRos());

    act(() => {
      result.current.connect(mockParams);
    });

    unmount();

    expect(closeMock).toHaveBeenCalled();
    expect(offMock.mock.calls.map(call => call[0])).toEqual([
      '/roboboy/control/status',
      'connection',
      'error',
      'close',
    ]);
  });

  it('reconnects with the same parameters when returning without fresh gateway status', () => {
    const rosInstances: Array<{ on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
    (ROSLIB.Ros as any).mockImplementation(function () {
      const instance = { on: vi.fn(), close: vi.fn() };
      rosInstances.push(instance);
      return instance;
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    const { result } = renderHook(() => useRos());
    act(() => result.current.connect(mockParams));
    const firstConnection = rosInstances[0].on.mock.calls.find(call => call[0] === 'connection')?.[1];
    act(() => firstConnection?.());

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(ROSLIB.Ros).toHaveBeenCalledTimes(2);
    expect(ROSLIB.Ros).toHaveBeenLastCalledWith({ url: 'ws://localhost/websocket' });
    expect(rosInstances[0].close).toHaveBeenCalled();
  });

  it('preserves a healthy controller on tab switches and reconnects only after status becomes stale', () => {
    vi.useFakeTimers();
    const instances: Array<{
      on: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      callOnConnection: ReturnType<typeof vi.fn>;
    }> = [];
    const wireSends: Array<ReturnType<typeof vi.fn>> = [];
    (ROSLIB.Ros as any).mockImplementation(function () {
      const instance = { on: vi.fn(), close: vi.fn(), callOnConnection: vi.fn() };
      wireSends.push(instance.callOnConnection);
      instances.push(instance);
      return instance;
    });
    const { result, unmount } = renderHook(() => useRos());
    act(() => result.current.connect(mockParams));
    act(() => instances[0].on.mock.calls.find(call => call[0] === 'connection')?.[1]());
    act(() =>
      instances[0].on.mock.calls.find(call => call[0] === '/roboboy/control/status')?.[1]({
        data: JSON.stringify({
          version: 1,
          selfId: 'a',
          owner: 'a',
          token: 'lease',
          state: 'owned',
          ready: true,
          leaseMs: 10000,
          pending: 0,
          adoptable: false,
          managing: false,
          reason: '',
          error: '',
          clients: [{ id: 'a', label: 'Alice' }],
        }),
      })
    );
    const switchTabs = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    act(switchTabs);
    expect(ROSLIB.Ros).toHaveBeenCalledTimes(1);
    expect(instances[0].close).not.toHaveBeenCalled();
    expect(result.current.connectionGeneration).toBe(1);
    act(() => vi.advanceTimersByTime(11000));
    act(switchTabs);
    expect(ROSLIB.Ros).toHaveBeenCalledTimes(2);
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(result.current.connectionGeneration).toBe(2);
    act(() => instances[1].on.mock.calls.find(call => call[0] === 'connection')?.[1]());
    expect(wireSends[1]).toHaveBeenCalledWith({ op: 'roboboy_control', action: 'status' });
    expect(wireSends[1]).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'acquire' }));
    unmount();
  });
});
