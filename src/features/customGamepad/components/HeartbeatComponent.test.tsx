import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeartbeatComponent, { isHeartbeatValueActive } from './HeartbeatComponent';
import type { GamepadComponentConfig } from '../types';

const roslibMock = vi.hoisted(() => ({
  subscribers: [] as Array<(message: unknown) => void>,
  unsubscribe: vi.fn(),
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function Topic() {
      return {
        subscribe: vi.fn((callback: (message: unknown) => void) => {
          roslibMock.subscribers.push(callback);
        }),
        unsubscribe: roslibMock.unsubscribe,
      };
    }),
  },
}));

describe('HeartbeatComponent', () => {
  const pulseConfig: GamepadComponentConfig = {
    id: 'heartbeat-1',
    type: 'heartbeat',
    position: { x: 0, y: 0, width: 1, height: 1 },
    label: 'Arm 1',
    action: {
      topic: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState',
    },
    config: {
      heartbeatMode: 'pulse',
      heartbeatTimeoutMs: 1000,
    },
  };

  beforeEach(() => {
    roslibMock.subscribers = [];
    roslibMock.unsubscribe.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks a recurring topic healthy until it becomes stale', () => {
    vi.useFakeTimers();
    render(<HeartbeatComponent config={pulseConfig} ros={{ isConnected: true } as any} />);

    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Waiting for heartbeat');
    expect(screen.getByText('Arm 1')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat unhealthy');

    act(() => {
      roslibMock.subscribers[0]({ position: [0] });
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat healthy');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat unhealthy');
  });

  it('reads nested boolean-compatible values without applying a stale timeout', () => {
    vi.useFakeTimers();
    const booleanConfig: GamepadComponentConfig = {
      ...pulseConfig,
      action: {
        topic: '/robot/status',
        messageType: 'custom_msgs/msg/RobotStatus',
        field: 'status.alive',
      },
      config: {
        heartbeatMode: 'boolean',
        heartbeatFieldPath: 'status.alive',
        heartbeatTimeoutMs: 100,
      },
    };

    render(<HeartbeatComponent config={booleanConfig} ros={{ isConnected: true } as any} />);
    act(() => roslibMock.subscribers[0]({ status: { alive: 0 } }));
    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat unhealthy');

    act(() => {
      roslibMock.subscribers[0]({ status: { alive: 'healthy' } });
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat healthy');
  });

  it('shows a preview without subscribing while editing', () => {
    render(<HeartbeatComponent config={pulseConfig} ros={{ isConnected: true } as any} isEditing />);

    expect(screen.getByRole('status')).toHaveAccessibleName('Arm 1: Heartbeat healthy');
    expect(roslibMock.subscribers).toHaveLength(0);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(
      <HeartbeatComponent config={pulseConfig} ros={{ isConnected: true } as any} />
    );

    unmount();
    expect(roslibMock.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('supports common boolean-compatible scalar values', () => {
    expect(isHeartbeatValueActive(true)).toBe(true);
    expect(isHeartbeatValueActive(1)).toBe(true);
    expect(isHeartbeatValueActive('alive')).toBe(true);
    expect(isHeartbeatValueActive(false)).toBe(false);
    expect(isHeartbeatValueActive(0)).toBe(false);
    expect(isHeartbeatValueActive('stopped')).toBe(false);
  });
});
