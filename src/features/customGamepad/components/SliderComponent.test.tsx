import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamepadComponentConfig } from '../types';
import SliderComponent from './SliderComponent';

const roslibMock = vi.hoisted(() => ({ publish: vi.fn() }));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function Topic() {
      return { advertise: vi.fn(), unadvertise: vi.fn(), publish: roslibMock.publish };
    }),
    Message: vi.fn(function Message(this: Record<string, unknown>, values: Record<string, unknown>) {
      Object.assign(this, values);
    }),
  },
}));

const slider = (messageType: string): GamepadComponentConfig => ({
  id: 'slider-1',
  type: 'slider',
  position: { x: 0, y: 0, width: 3, height: 1 },
  action: { topic: '/throttle', messageType, field: 'data' },
  config: { min: -1, max: 1, step: 0.1 },
});

describe('SliderComponent', () => {
  beforeEach(() => roslibMock.publish.mockClear());

  it.each([
    ['std_msgs/Float32', 0.5],
    ['std_msgs/msg/Float32', 0.5],
    ['std_msgs/Float64', 0.5],
    ['std_msgs/msg/Float64', 0.5],
    ['std_msgs/Int32', 1],
    ['std_msgs/msg/Int32', 1],
  ])('publishes %s values', (messageType, published) => {
    render(<SliderComponent config={slider(messageType)} ros={{ isConnected: true } as never} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } });
    expect(roslibMock.publish).toHaveBeenCalledWith(expect.objectContaining({ data: published }));
  });
});
