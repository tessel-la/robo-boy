import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraComponent from './CameraComponent';
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

describe('CameraComponent', () => {
  const baseConfig: GamepadComponentConfig = {
    id: 'camera-1',
    type: 'camera',
    position: { x: 0, y: 0, width: 4, height: 3 },
    label: 'Camera',
    action: {
      topic: '/camera/image_raw/compressed',
      messageType: 'sensor_msgs/CompressedImage',
    },
    config: {
      cameraTransport: 'proxy',
    },
  };

  beforeEach(() => {
    roslibMock.subscribers = [];
    roslibMock.unsubscribe.mockClear();
  });

  it('renders proxy camera stream URLs', () => {
    render(<CameraComponent config={baseConfig} ros={{ isConnected: true } as any} />);

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/video_stream/stream?topic=/camera/image_raw/compressed&type=ros_compressed'
    );
  });

  it('shows a fallback state without a topic', () => {
    render(<CameraComponent config={{ ...baseConfig, action: undefined }} ros={{ isConnected: true } as any} />);

    expect(screen.getByText('No camera topic selected')).toBeInTheDocument();
  });

  it('subscribes and cleans up ROS camera streams', () => {
    const { unmount } = render(
      <CameraComponent
        config={{ ...baseConfig, config: { cameraTransport: 'ros' } }}
        ros={{ isConnected: true } as any}
      />
    );

    expect(roslibMock.subscribers).toHaveLength(1);
    act(() => {
      roslibMock.subscribers[0]({ data: 'abc123', format: 'jpeg' });
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,abc123');

    unmount();
    expect(roslibMock.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
