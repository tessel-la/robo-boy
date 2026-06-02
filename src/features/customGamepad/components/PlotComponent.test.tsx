import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlotComponent from './PlotComponent';
import { GamepadComponentConfig } from '../types';

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

describe('PlotComponent', () => {
  const baseConfig: GamepadComponentConfig = {
    id: 'plot-1',
    type: 'plot',
    position: { x: 0, y: 0, width: 4, height: 2 },
    label: 'Velocity',
    action: {
      topic: '/cmd_vel',
      messageType: 'geometry_msgs/Twist',
      field: 'linear.x',
    },
    config: {
      fieldPath: 'linear.x',
      timeWindowSec: 5,
      autoScale: true,
    },
  };

  beforeEach(() => {
    roslibMock.subscribers = [];
    roslibMock.unsubscribe.mockClear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes and plots numeric samples', () => {
    const nowSpy = vi.spyOn(Date, 'now');

    render(<PlotComponent config={baseConfig} ros={{ isConnected: true } as any} />);
    expect(roslibMock.subscribers).toHaveLength(1);

    act(() => {
      nowSpy.mockReturnValue(1_000);
      roslibMock.subscribers[0]({ linear: { x: 1 } });
      nowSpy.mockReturnValue(2_000);
      roslibMock.subscribers[0]({ linear: { x: 2 } });
      nowSpy.mockReturnValue(3_000);
      roslibMock.subscribers[0]({ linear: { x: 3 } });
    });

    expect(screen.getByText('3.000')).toBeInTheDocument();
    const polyline = document.querySelector('.plot-svg polyline');
    const points = polyline?.getAttribute('points')?.split(' ') ?? [];
    expect(points).toHaveLength(3);
    expect(points[0].split(',')[0]).toBe('24.0');
    expect(points[2].split(',')[0]).toBe('308.0');

  });

  it('plots multiple numeric fields from one topic', () => {
    render(
      <PlotComponent
        config={{
          ...baseConfig,
          config: {
            ...baseConfig.config,
            fieldPaths: ['linear.x', 'angular.z'],
          },
        }}
        ros={{ isConnected: true } as any}
      />
    );

    act(() => {
      roslibMock.subscribers[0]({ linear: { x: 1 }, angular: { z: -0.25 } });
    });

    expect(screen.getByText(/x 1.00/)).toBeInTheDocument();
    expect(screen.getByText(/z -0.25/)).toBeInTheDocument();
    expect(document.querySelectorAll('.plot-svg polyline')).toHaveLength(2);
  });

  it('shows a field error when messages do not contain numeric data', () => {
    render(<PlotComponent config={baseConfig} ros={{ isConnected: true } as any} />);

    act(() => {
      roslibMock.subscribers[0]({ linear: { x: 'fast' } });
    });
    expect(screen.getByText('No numeric data at linear.x')).toBeInTheDocument();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<PlotComponent config={baseConfig} ros={{ isConnected: true } as any} />);

    unmount();
    expect(roslibMock.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
