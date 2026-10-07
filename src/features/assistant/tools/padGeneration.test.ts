import { describe, expect, it } from 'vitest';
import { normalizePadLayout } from './padGeneration';

const joystick = {
  id: 'stick',
  type: 'joystick',
  position: { x: 0, y: 0, width: 3, height: 3 },
  action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
};

describe('normalizePadLayout', () => {
  it('keeps a well-formed layout intact and fills metadata/rosConfig', () => {
    const layout = normalizePadLayout({
      id: 'drive-pad',
      name: 'Drive Pad',
      gridSize: { width: 8, height: 4 },
      cellSize: 80,
      components: [joystick],
    });

    expect(layout.id).toBe('drive-pad');
    expect(layout.components[0].action).toEqual({ topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' });
    expect(layout.rosConfig).toEqual({ defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' });
    expect(layout.metadata.version).toBe('1.0.0');
    expect(Date.parse(layout.metadata.created)).not.toBeNaN();
  });

  it('repairs the alias key models commonly emit instead of "topic"', () => {
    const layout = normalizePadLayout({
      name: 'Alias Pad',
      components: [{ ...joystick, action: { topicName: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', field: 'linear.x' } }],
    });
    expect(layout.components[0].action).toEqual({
      topic: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist',
      field: 'linear.x',
    });
  });

  it('moves supplied primary service and action payloads into executable button events', () => {
    const layout = normalizePadLayout({
      name: 'Service Pad',
      components: [
        { id: 'a', type: 'button', position: {}, action: { name: '/set_bool', type: 'service', messageType: 'std_srvs/srv/SetBool', request: { data: true } } },
        { id: 'b', type: 'button', position: {}, action: { name: '/nav', type: 'action', messageType: 'nav2_msgs/action/NavigateToPose' }, config: { goal: { pose: { header: { frame_id: 'map' } } } } },
      ],
    });
    expect(layout.components[0].action).toBeUndefined();
    expect(layout.components[0].eventOperations?.press).toEqual({ kind: 'service', name: '/set_bool', messageType: 'std_srvs/srv/SetBool', payload: { data: true } });
    expect(layout.components[1].eventOperations?.press?.payload).toEqual({ pose: { header: { frame_id: 'map' } } });
  });

  it('rejects a Home action with no configured trajectory instead of silently producing a dead button', () => {
    expect(() => normalizePadLayout({ name: 'Pad', components: [{ type: 'button', action: { name: '/home', type: 'action', messageType: 'control_msgs/action/FollowJointTrajectory' }, config: {} }] })).toThrow(/no payload/);
    expect(() => normalizePadLayout({ name: 'Pad', components: [{ type: 'button', eventOperations: { press: { kind: 'action', name: '/home', messageType: 'control_msgs/action/FollowJointTrajectory', payload: {} } } }] })).toThrow(/empty goal/);
  });

  it('normalizes eventOperations, inferring the operation kind when omitted', () => {
    const layout = normalizePadLayout({
      name: 'Ops Pad',
      components: [
        {
          id: 'btn',
          type: 'button',
          position: {},
          eventOperations: {
            press: { serviceName: '/estop', messageType: 'std_srvs/srv/Trigger', payload: {} },
            release: { kind: 'topic', name: '/cmd', messageType: 'std_msgs/msg/Bool', payload: { data: false } },
            bogus: { nothing: true },
          },
        },
      ],
    });
    const operations = layout.components[0].eventOperations!;
    expect(operations.press).toEqual({ kind: 'service', name: '/estop', messageType: 'std_srvs/srv/Trigger', payload: {} });
    expect(operations.release).toEqual({ kind: 'topic', name: '/cmd', messageType: 'std_msgs/msg/Bool', payload: { data: false } });
  });

  it('drops components with an unsupported type and de-duplicates ids', () => {
    const layout = normalizePadLayout({
      name: 'Mixed Pad',
      components: [joystick, { id: 'stick', type: 'joystick', position: {} }, { id: 'x', type: 'hologram', position: {} }],
    });
    expect(layout.components).toHaveLength(2);
    expect(new Set(layout.components.map(component => component.id)).size).toBe(2);
    expect(layout.components.some(component => (component.type as string) === 'hologram')).toBe(false);
  });

  it('clamps positions inside the grid', () => {
    const layout = normalizePadLayout({
      name: 'Overflow Pad',
      gridSize: { width: 4, height: 3 },
      components: [{ ...joystick, position: { x: 99, y: -5, width: 40, height: 40 } }],
    });
    const position = layout.components[0].position;
    expect(position.width).toBeLessThanOrEqual(4);
    expect(position.height).toBeLessThanOrEqual(3);
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.x + position.width).toBeLessThanOrEqual(4);
    expect(position.y + position.height).toBeLessThanOrEqual(3);
  });

  it('moves overlapping generated controls into free grid cells', () => {
    const layout = normalizePadLayout({
      name: 'No overlap',
      gridSize: { width: 4, height: 2 },
      components: [
        { id: 'a', type: 'button', position: { x: 0, y: 0, width: 2, height: 2 } },
        { id: 'b', type: 'button', position: { x: 0, y: 0, width: 2, height: 2 } },
      ],
    });
    expect(layout.components[0].position).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(layout.components[1].position).toEqual({ x: 2, y: 0, width: 2, height: 2 });
  });

  it('rejects a layout with no usable components at all', () => {
    expect(() => normalizePadLayout({ name: 'Empty', components: [] })).toThrow(/no usable components/);
    expect(() => normalizePadLayout({ name: 'Bad types', components: [{ type: 'nope' }] })).toThrow(/no usable components/);
  });

  it('rejects a layout that is not an object or has no components array', () => {
    expect(() => normalizePadLayout('nope')).toThrow(/must be an object/);
    expect(() => normalizePadLayout({ name: 'x' })).toThrow(/must contain a components array/);
  });
});
