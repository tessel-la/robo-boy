import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GamepadComponentConfig } from '../types';
import GaugeComponent, { dialArc, thresholdZones } from './GaugeComponent';
import LevelComponent, { levelOrientation } from './LevelComponent';
import ReadoutComponent from './ReadoutComponent';
import StateComponent from './StateComponent';
import SetpointComponent from './SetpointComponent';
import TextComponent from './TextComponent';
import GamepadComponent from './GamepadComponent';

const roslibMock = vi.hoisted(() => ({
  topics: [] as Array<{ name: string; messageType: string; subscriber?: (message: unknown) => void }>,
  unsubscribe: vi.fn(),
  advertise: vi.fn(),
  unadvertise: vi.fn(),
  publish: vi.fn(),
}));

vi.mock('roslib', () => ({
  default: {
    Topic: vi.fn(function Topic(this: unknown, options: { name: string; messageType: string }) {
      const entry: { name: string; messageType: string; subscriber?: (message: unknown) => void } = {
        name: options.name,
        messageType: options.messageType,
      };
      roslibMock.topics.push(entry);
      return {
        subscribe: (callback: (message: unknown) => void) => { entry.subscriber = callback; },
        unsubscribe: roslibMock.unsubscribe,
        advertise: roslibMock.advertise,
        unadvertise: roslibMock.unadvertise,
        publish: (message: unknown) => roslibMock.publish(options.name, message),
      };
    }),
    Message: vi.fn(function Message(this: Record<string, unknown>, values: Record<string, unknown>) {
      Object.assign(this, values);
    }),
  },
}));

const ros = { isConnected: true } as never;
const send = (topic: string, message: unknown) => act(() => {
  roslibMock.topics.filter(entry => entry.name === topic).forEach(entry => entry.subscriber?.(message));
});

const component = (
  type: GamepadComponentConfig['type'],
  action: { topic: string; messageType: string; field?: string },
  config: GamepadComponentConfig['config'] = {},
  label = 'Value',
  position = { x: 0, y: 0, width: 2, height: 1 }
): GamepadComponentConfig => ({ id: `${type}-1`, type, label, position, action, config });

describe('value components', () => {
  beforeEach(() => {
    roslibMock.topics = [];
    roslibMock.unsubscribe.mockClear();
    roslibMock.advertise.mockClear();
    roslibMock.unadvertise.mockClear();
    roslibMock.publish.mockClear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(performance.now());
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a battery percentage on a gauge, scaled, with its alarm', () => {
    const gauge = component(
      'gauge',
      { topic: '/battery', messageType: 'sensor_msgs/msg/BatteryState', field: 'percentage' },
      { min: 0, max: 100, scale: 100, unit: '%', warnAt: 30, alarmAt: 15, alertBelow: true },
      'Battery',
      { x: 0, y: 0, width: 2, height: 2 }
    );
    const { container, unmount } = render(<GaugeComponent config={gauge} ros={ros} />);

    expect(roslibMock.topics).toEqual([expect.objectContaining({ name: '/battery', messageType: 'sensor_msgs/msg/BatteryState' })]);
    expect(screen.getByText('Waiting for /battery…')).toBeInTheDocument();

    send('/battery', { percentage: 0.42, voltage: 24.2 });
    const meter = screen.getByRole('meter', { name: 'Battery' });
    expect(meter).toHaveAttribute('aria-valuenow', '42');
    expect(meter).toHaveAttribute('aria-valuetext', '42 %');
    expect(meter).toHaveClass('level-normal');
    expect(container.querySelectorAll('.pad-gauge-zone')).toHaveLength(2);

    send('/battery', { percentage: 0.1 });
    expect(meter).toHaveAttribute('aria-valuenow', '10');
    expect(meter).toHaveClass('level-alarm');

    unmount();
    expect(roslibMock.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('draws the dial and its bands from the range', () => {
    expect(dialArc(0, 0)).toBe('');
    expect(dialArc(0, 1)).toMatch(/^M [\d.]+ [\d.]+ A 44 44 0 1 1 /);
    expect(thresholdZones({ warnAt: 60, alarmAt: 80 }, { min: 0, max: 100 })).toEqual([
      { level: 'warning', from: 0.6, to: 0.8 },
      { level: 'alarm', from: 0.8, to: 1 },
    ]);
    expect(thresholdZones({ warnAt: 30, alertBelow: true }, { min: 0, max: 100 })).toEqual([
      { level: 'warning', from: 0, to: 0.3 },
    ]);
  });

  it('reads a nested Twist field on a readout and explains a field that is not there', () => {
    const readout = component('readout', { topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', field: 'linear.x' }, { unit: 'm/s' }, 'Speed');
    render(<ReadoutComponent config={readout} ros={ros} />);

    send('/cmd_vel', { linear: { x: 0.8, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    // Below 1, automatic decimals show three places.
    expect(screen.getByRole('group', { name: 'Speed: 0.800 m/s' })).toBeInTheDocument();

    send('/cmd_vel', { angular: { z: 1 } });
    expect(screen.getByText('No “linear.x” in the messages')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Speed: — m/s' })).toBeInTheDocument();
  });

  it('refuses text where a number belongs', () => {
    const readout = component('readout', { topic: '/mode', messageType: 'std_msgs/msg/String', field: 'data' });
    render(<ReadoutComponent config={readout} ros={ros} />);
    send('/mode', { data: 'RUNNING' });
    expect(screen.getByText('“data” is text, not a number')).toBeInTheDocument();
  });

  it('shows an Int32 on a level bar laid along its longer side', () => {
    const level = component('level', { topic: '/tank', messageType: 'std_msgs/msg/Int32', field: 'data' }, { min: 0, max: 200 }, 'Tank', { x: 0, y: 0, width: 1, height: 3 });
    expect(levelOrientation(level)).toBe('vertical');
    expect(levelOrientation({ ...level, config: { orientation: 'horizontal' } })).toBe('horizontal');
    const { container } = render(<LevelComponent config={level} ros={ros} />);

    send('/tank', { data: 50 });
    expect(screen.getByRole('meter', { name: 'Tank' })).toHaveAttribute('aria-valuenow', '50');
    expect(container.querySelector('.pad-level')).toHaveClass('vertical');
    expect((container.querySelector('.pad-level-fill') as HTMLElement).style.height).toBe('25%');
  });

  it('marks a value stale when its topic goes quiet', () => {
    vi.useFakeTimers();
    const readout = component('readout', { topic: '/temp', messageType: 'sensor_msgs/msg/Temperature', field: 'temperature' }, { staleAfterMs: 1000 }, 'Temp');
    const { container } = render(<ReadoutComponent config={readout} ros={ros} />);
    send('/temp', { temperature: 21.5 });
    expect(container.querySelector('.pad-value')).not.toHaveClass('is-stale');

    act(() => { vi.advanceTimersByTime(1100); });
    expect(container.querySelector('.pad-value')).toHaveClass('is-stale');
    expect(screen.getByText('Stale')).toBeInTheDocument();

    send('/temp', { temperature: 21.7 });
    expect(container.querySelector('.pad-value')).not.toHaveClass('is-stale');
  });

  it('names and colours a Bool or a string state, and shows unknown values as they are', () => {
    const state = component('state', { topic: '/estop', messageType: 'std_msgs/msg/Bool', field: 'data' }, {
      stateMappings: [{ value: 'true', label: 'Stopped', tone: 'error' }, { value: 'false', label: 'Clear', tone: 'ok' }],
    }, 'E-stop');
    const { container, rerender } = render(<StateComponent config={state} ros={ros} />);

    send('/estop', { data: true });
    expect(screen.getByRole('group', { name: 'E-stop: Stopped' })).toBeInTheDocument();
    expect(container.querySelector('.pad-state')).toHaveClass('tone-error');

    send('/estop', { data: false });
    expect(container.querySelector('.pad-state')).toHaveClass('tone-ok');

    const mode = component('state', { topic: '/mode', messageType: 'std_msgs/msg/String', field: 'data' }, {
      stateMappings: [{ value: 'IDLE', label: 'Idle', tone: 'neutral' }],
    }, 'Mode');
    rerender(<StateComponent config={mode} ros={ros} />);
    send('/mode', { data: 'DOCKING' });
    expect(screen.getByRole('group', { name: 'Mode: DOCKING' })).toBeInTheDocument();
    expect(container.querySelector('.pad-state')).toHaveClass('tone-neutral');
  });

  it('keeps the last messages of a log topic, newest last', () => {
    const text = component('text', { topic: '/rosout', messageType: 'rcl_interfaces/msg/Log', field: 'msg' }, { historyLength: 2 }, 'Log');
    render(<TextComponent config={text} ros={ros} />);

    send('/rosout', { level: 20, msg: 'one' });
    send('/rosout', { level: 30, msg: 'two' });
    send('/rosout', { level: 40, msg: 'three' });
    const lines = screen.getAllByRole('listitem').map(item => item.querySelector('span')?.textContent);
    expect(lines).toEqual(['two', 'three']);
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('moves to a new topic when its settings change, starting from no value', () => {
    const readout = component('readout', { topic: '/a', messageType: 'std_msgs/msg/Float64', field: 'data' }, { decimals: 1 }, 'Speed');
    const { rerender } = render(<ReadoutComponent config={readout} ros={ros} />);
    send('/a', { data: 4 });
    expect(screen.getByRole('group', { name: 'Speed: 4.0' })).toBeInTheDocument();

    rerender(<ReadoutComponent config={{ ...readout, action: { topic: '/b', messageType: 'std_msgs/msg/Float64', field: 'data' } }} ros={ros} />);
    expect(roslibMock.unsubscribe).toHaveBeenCalledTimes(1);
    expect(roslibMock.topics.map(entry => entry.name)).toEqual(['/a', '/b']);
    expect(screen.getByRole('group', { name: 'Speed: —' })).toBeInTheDocument();
    send('/b', { data: 7 });
    expect(screen.getByRole('group', { name: 'Speed: 7.0' })).toBeInTheDocument();
  });

  it('subscribes to nothing while the pad is edited, and previews a value', () => {
    const gauge = component('gauge', { topic: '/g', messageType: 'std_msgs/msg/Float64', field: 'data' }, { min: 0, max: 10 });
    render(<GaugeComponent config={gauge} ros={ros} isEditing />);
    expect(roslibMock.topics).toHaveLength(0);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '6.2');
  });

  it('says so when ROS is not connected or no topic is set', () => {
    const readout = component('readout', { topic: '/r', messageType: 'std_msgs/msg/Float64', field: 'data' });
    const { rerender } = render(<ReadoutComponent config={readout} ros={{ isConnected: false } as never} />);
    expect(screen.getByText('ROS disconnected')).toBeInTheDocument();
    rerender(<ReadoutComponent config={{ ...readout, action: { topic: '', messageType: '' } }} ros={ros} />);
    expect(screen.getByText('No topic selected')).toBeInTheDocument();
  });

  it('sends a setpoint when asked, typed for its field', () => {
    const setpoint = component('setpoint', { topic: '/target', messageType: 'std_msgs/msg/Int32', field: 'data' }, { min: 0, max: 10, step: 1, fieldType: 'int32' }, 'Target');
    render(<SetpointComponent config={setpoint} ros={ros} />);
    expect(roslibMock.advertise).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Increase Target' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Target' }));
    expect(roslibMock.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send Target' }));
    expect(roslibMock.publish).toHaveBeenCalledWith('/target', { data: 2 });

    const input = screen.getByRole('spinbutton', { name: 'Target value' });
    fireEvent.change(input, { target: { value: '7.6' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(roslibMock.publish).toHaveBeenLastCalledWith('/target', { data: 8 });
    expect(input).toHaveValue(8);

    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(10);
    expect(screen.getByRole('button', { name: 'Increase Target' })).toBeDisabled();
  });

  it('sends every change of a Twist setpoint to its one field', () => {
    const setpoint = component('setpoint', { topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', field: 'linear.x' }, {
      min: -1, max: 1, step: 0.25, sendOnChange: true, fieldType: 'float64',
    }, 'Cruise');
    render(<SetpointComponent config={setpoint} ros={ros} />);
    expect(screen.queryByRole('button', { name: 'Send Cruise' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Increase Cruise' }));
    expect(roslibMock.publish).toHaveBeenCalledWith('/cmd_vel', { linear: { x: 0.25 } });
  });

  it('cannot send while ROS is disconnected or the pad is edited', () => {
    const setpoint = component('setpoint', { topic: '/target', messageType: 'std_msgs/msg/Float64', field: 'data' }, { min: 0, max: 10 }, 'Target');
    const { rerender } = render(<SetpointComponent config={setpoint} ros={{ isConnected: false } as never} />);
    expect(screen.getByText('ROS disconnected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Target' })).toBeDisabled();

    rerender(<SetpointComponent config={setpoint} ros={ros} isEditing />);
    expect(screen.getByRole('button', { name: 'Send Target' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase Target' })).toBeDisabled();
  });

  it('are drawn by the pad with their own label instead of the generic one', () => {
    const gauge = component('gauge', { topic: '/g', messageType: 'std_msgs/msg/Float64', field: 'data' }, {}, 'Pressure');
    const { container } = render(<GamepadComponent config={gauge} ros={ros} />);
    expect(screen.getByTestId('gauge-component')).toBeInTheDocument();
    expect(container.querySelector('.component-label')).toBeNull();
    expect(screen.getByText('Pressure')).toHaveClass('pad-value-label');
  });
});
