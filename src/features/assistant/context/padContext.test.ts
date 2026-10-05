import type { Ros } from 'roslib';
import { describe, expect, it, vi } from 'vitest';
import type { CustomGamepadLayout, GamepadComponentConfig } from '../../customGamepad/types';

const samples = vi.hoisted(() => ({ byTopic: new Map<string, unknown>() }));
vi.mock('./rosContext', () => ({
  sampleRosTopic: vi.fn(async (_ros: unknown, topic: string) => {
    if (topic === '/fails') throw new Error('rosbridge dropped the request');
    const value = samples.byTopic.get(topic);
    return { topic, messageType: '', samples: value === undefined ? [] : [{ receivedAt: 0, value }], timedOut: value === undefined, limits: {} };
  }),
}));

import { padDisplayBindings, readPadValues, wantsPadValues } from './padContext';

const component = (patch: Partial<GamepadComponentConfig>): GamepadComponentConfig => ({
  id: patch.type ?? 'c',
  type: 'readout',
  position: { x: 0, y: 0, width: 1, height: 1 },
  ...patch,
});
const layout = (components: GamepadComponentConfig[]): CustomGamepadLayout =>
  ({ id: 'dash', name: 'Dashboard', gridSize: { width: 8, height: 4 }, cellSize: 80, components }) as unknown as CustomGamepadLayout;

const dashboard = layout([
  component({ id: 'battery', type: 'gauge', label: 'Battery', action: { topic: '/battery', messageType: 'sensor_msgs/msg/BatteryState', field: 'percentage' }, config: { scale: 100, unit: '%', decimals: 0, warnAt: 30, alarmAt: 15, alertBelow: true } }),
  component({ id: 'mode', type: 'state', label: 'Mode', action: { topic: '/mode', messageType: 'std_msgs/msg/String', field: 'data' }, config: { stateMappings: [{ value: 'AUTO', label: 'Autonomous', tone: 'ok' }] } }),
  component({ id: 'log', type: 'text', label: 'Log', action: { topic: '/rosout', messageType: 'rcl_interfaces/msg/Log', field: 'msg' } }),
  component({ id: 'speed', type: 'plot', label: 'Speed', action: { topic: '/odom', messageType: 'nav_msgs/msg/Odometry' }, config: { fieldPaths: ['twist.twist.linear.x', 'twist.twist.angular.z'] } }),
  component({ id: 'alive', type: 'heartbeat', label: 'Alive', action: { topic: '/heartbeat', messageType: 'std_msgs/msg/Bool' }, config: { heartbeatFieldPath: 'data' } }),
  component({ id: 'drive', type: 'joystick', label: 'Drive', action: { topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist' } }),
  component({ id: 'silent', type: 'readout', label: 'Silent', action: { topic: '/silent', messageType: 'std_msgs/msg/Float64', field: 'data' } }),
]);

describe('live Pad values for the assistant', () => {
  it('reads values for questions about readings, not for edits to a Pad', () => {
    for (const phrase of ['what does the pad show', 'what is the battery level', 'what are the current readings'])
      expect(wantsPadValues(phrase), phrase).toBe(true);
    for (const phrase of ['add a gauge to the pad', 'set the time series values', 'what is the status of the robot'])
      expect(wantsPadValues(phrase), phrase).toBe(false);
  });

  it('lists the display widgets and the fields they show', () => {
    expect(padDisplayBindings(dashboard).map(binding => [binding.component, binding.topic, binding.fields])).toEqual([
      ['battery', '/battery', ['percentage']],
      ['mode', '/mode', ['data']],
      ['log', '/rosout', ['msg']],
      ['speed', '/odom', ['twist.twist.linear.x', 'twist.twist.angular.z']],
      ['alive', '/heartbeat', ['data']],
      ['silent', '/silent', ['data']],
    ]);
  });

  it('formats each reading as the Pad shows it, and says when a topic is silent', async () => {
    samples.byTopic = new Map<string, unknown>([
      ['/battery', { percentage: 0.12 }],
      ['/mode', { data: 'AUTO' }],
      ['/rosout', { msg: 'Docked' }],
      ['/odom', { twist: { twist: { linear: { x: 0.5 }, angular: { z: -0.1 } } } }],
      ['/heartbeat', { data: true }],
    ]);
    const result = await readPadValues({} as Ros, dashboard);
    expect(result.pad).toBe('Dashboard');
    expect(result.readings).toEqual([
      { widget: 'Battery', type: 'gauge', topic: '/battery', values: [{ field: 'percentage', shown: '12 %', level: 'alarm' }] },
      { widget: 'Mode', type: 'state', topic: '/mode', values: [{ field: 'data', raw: 'AUTO', state: 'Autonomous (ok)' }] },
      { widget: 'Log', type: 'text', topic: '/rosout', values: [{ field: 'msg', raw: 'Docked' }] },
      { widget: 'Speed', type: 'plot', topic: '/odom', values: [{ field: 'twist.twist.linear.x', shown: expect.any(String) }, { field: 'twist.twist.angular.z', shown: expect.any(String) }] },
      { widget: 'Alive', type: 'heartbeat', topic: '/heartbeat', values: [{ field: 'data', raw: 'true' }] },
      { widget: 'Silent', type: 'readout', topic: '/silent', unavailable: 'No message arrived within 2.5 s.' },
    ]);
  });

  it('reads at most eight topics and survives a failing one', async () => {
    const many = layout([
      ...Array.from({ length: 9 }, (_, index) => component({ id: `r${index}`, label: `R${index}`, action: { topic: `/t${index}`, messageType: 'std_msgs/msg/Float64', field: 'data' } })),
      component({ id: 'broken', label: 'Broken', action: { topic: '/fails', messageType: 'std_msgs/msg/Float64', field: 'data' } }),
    ]);
    samples.byTopic = new Map(Array.from({ length: 9 }, (_, index) => [`/t${index}`, { data: index }]));
    const result = await readPadValues({} as Ros, many);
    expect(result.readings[0]).toMatchObject({ widget: 'R0', values: [{ shown: expect.stringMatching(/^0/) }] });
    expect(result.readings[8]).toEqual({ widget: 'R8', type: 'readout', topic: '/t8', unavailable: 'Not read: too many topics on this Pad.' });
    expect(result.readings[9]).toMatchObject({ widget: 'Broken', unavailable: expect.any(String) });
  });
});
