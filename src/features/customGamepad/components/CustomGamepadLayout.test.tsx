import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomGamepadLayout as Layout } from '../types';
import CustomGamepadLayout from './CustomGamepadLayout';

const roslibMock = vi.hoisted(() => ({
  topics: [] as Array<{
    publish: ReturnType<typeof vi.fn>;
    advertise: ReturnType<typeof vi.fn>;
    unadvertise: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function Topic() {
      const topic = {
        publish: vi.fn(),
        advertise: vi.fn(),
        unadvertise: vi.fn(),
      };
      roslibMock.topics.push(topic);
      return topic;
    }),
    Message: vi.fn(function Message(value: unknown) {
      return value;
    }),
  },
}));

vi.mock('./GamepadComponent', () => ({
  default: ({ config, onJoyAxesChange }: any) => (
    <div>
      <button onClick={() => onJoyAxesChange(config, config.id === 'left' ? [0.5, -0.25] : [-0.75, 1])}>
        Move {config.id}
      </button>
      <button onClick={() => onJoyAxesChange(config, [0, 0])}>
        Stop {config.id}
      </button>
    </div>
  ),
}));

const layout: Layout = {
  id: 'dual-stick',
  name: 'Dual Stick',
  gridSize: { width: 8, height: 4 },
  cellSize: 80,
  components: [
    {
      id: 'left',
      type: 'joystick',
      position: { x: 0, y: 0, width: 2, height: 2 },
      action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy' },
      config: { axes: ['0', '1'] },
    },
    {
      id: 'right',
      type: 'joystick',
      position: { x: 4, y: 0, width: 2, height: 2 },
      action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy' },
      config: { axes: ['2', '3'] },
    },
  ],
  rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' },
  metadata: { created: 'now', modified: 'now', version: '1.0.0' },
};

describe('CustomGamepadLayout Joy aggregation', () => {
  beforeEach(() => {
    roslibMock.topics = [];
  });

  it('preserves simultaneous stick axes and resets each stick independently', () => {
    const { unmount } = render(<CustomGamepadLayout layout={layout} ros={{} as any} />);
    const topic = roslibMock.topics[0];

    expect(roslibMock.topics).toHaveLength(1);
    expect(topic.advertise).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop left' }));

    expect(topic.publish.mock.calls.map(([message]) => message.axes)).toEqual([
      [0.5, -0.25, 0, 0],
      [0.5, -0.25, -0.75, 1],
      [0, 0, -0.75, 1],
    ]);

    unmount();
    expect(topic.publish.mock.calls[topic.publish.mock.calls.length - 1][0].axes).toEqual([0, 0, 0, 0]);
    expect(topic.unadvertise).toHaveBeenCalledOnce();
  });
});
