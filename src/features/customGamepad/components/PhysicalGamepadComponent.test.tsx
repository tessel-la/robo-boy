import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamepadComponentConfig } from '../types';
import PhysicalGamepadComponent from './PhysicalGamepadComponent';

const mocks = vi.hoisted(() => ({
  advertise: vi.fn(),
  publish: vi.fn(),
  unadvertise: vi.fn(),
  execute: vi.fn(() => Promise.resolve()),
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function () {
      return { advertise: mocks.advertise, publish: mocks.publish, unadvertise: mocks.unadvertise };
    }),
    Message: vi.fn(function (value) {
      return value;
    }),
  },
}));

vi.mock('../../../utils/rosOperations', () => ({ executeRosOperation: mocks.execute }));

const makeGamepad = (pressedIndex?: number, connected = true): Gamepad =>
  ({
    axes: [0.5, -0.5, 0.25, -0.25],
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: index === pressedIndex,
      touched: index === pressedIndex,
      value: index === pressedIndex ? 1 : 0,
    })),
    connected,
    hapticActuators: [],
    id: 'Sony DualSense Wireless Controller',
    index: 0,
    mapping: 'standard',
    timestamp: 1,
    vibrationActuator: null,
  }) as unknown as Gamepad;

const config: GamepadComponentConfig = {
  id: 'physical',
  type: 'physical-gamepad',
  position: { x: 0, y: 0, width: 6, height: 4 },
  action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
  config: {
    physicalGamepadProfile: 'auto',
    physicalGamepadDeadzone: 0.08,
    physicalGamepadBindings: {
      'face-bottom': {
        press: { kind: 'service', name: '/start', messageType: 'std_srvs/srv/Trigger' },
        release: { kind: 'topic', name: '/released', messageType: 'std_msgs/msg/Bool', payload: { data: true } },
      },
    },
  },
};

describe('PhysicalGamepadComponent', () => {
  let gamepads: Array<Gamepad | null>;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    gamepads = [makeGamepad()];
    frames = [];
    mocks.advertise.mockReset();
    mocks.publish.mockReset();
    mocks.unadvertise.mockReset();
    mocks.execute.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: vi.fn(() => gamepads as (Gamepad | null)[]),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'getGamepads');
  });

  const runFrame = (time: number) =>
    act(() => {
      const frame = frames.shift();
      if (!frame) throw new Error('No animation frame queued');
      frame(time);
    });

  it('renders live PlayStation controls, publishes Joy, and dispatches button edges', async () => {
    render(<PhysicalGamepadComponent config={config} ros={{} as any} />);
    expect(mocks.advertise).toHaveBeenCalledOnce();

    runFrame(100);
    expect(await screen.findByText(/Sony DualSense Wireless Controller/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'playstation gamepad visualization' })).toBeInTheDocument();
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        axes: expect.arrayContaining([expect.closeTo(0.4565, 3), expect.closeTo(-0.4565, 3)]),
        buttons: expect.arrayContaining([0]),
      })
    );

    gamepads = [makeGamepad(0)];
    runFrame(116);
    await waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ kind: 'service', name: '/start' }),
        expect.any(AbortSignal)
      )
    );

    gamepads = [makeGamepad()];
    runFrame(132);
    await waitFor(() =>
      expect(mocks.execute).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ kind: 'topic', name: '/released' }),
        expect.any(AbortSignal)
      )
    );
  });

  it('publishes a neutral message when the controller disconnects and cleans up the publisher', () => {
    const { unmount } = render(<PhysicalGamepadComponent config={config} ros={{} as any} />);
    runFrame(100);
    gamepads = [];
    runFrame(116);

    expect(mocks.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        axes: [0, 0, 0, 0],
        buttons: Array(17).fill(0),
      })
    );
    unmount();
    expect(mocks.unadvertise).toHaveBeenCalledOnce();
  });
});
