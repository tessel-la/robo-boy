import { describe, expect, it } from 'vitest';
import { summarizePadValidation, validatePadAgainstRos } from './padValidator';
import type { CustomGamepadLayout } from '../../customGamepad/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';

const baseLayout = (overrides: Partial<CustomGamepadLayout['components'][number]>[]): CustomGamepadLayout => ({
  id: 'pad-1',
  name: 'Test Pad',
  gridSize: { width: 8, height: 4 },
  cellSize: 60,
  components: overrides.map((component, index) => ({
    id: `component-${index}`,
    type: 'button',
    position: { x: 0, y: 0, width: 1, height: 1 },
    ...component,
  })) as CustomGamepadLayout['components'],
  rosConfig: { defaultTopic: '/cmd_vel', defaultMessageType: 'geometry_msgs/Twist' },
  metadata: { created: '2024-01-01', modified: '2024-01-01', version: '1.0.0' },
});

const discovery: ROSDiscoveryResult = {
  topics: [{ name: '/cmd_vel', type: 'geometry_msgs/Twist' }],
  services: [{ name: '/set_bool', type: 'std_srvs/srv/SetBool' }],
  actions: [{ name: '/navigate', type: 'nav2_msgs/action/NavigateToPose', namespace: '/navigate' }],
};

describe('validatePadAgainstRos', () => {
  it('reports no issues when every reference matches the connected robot', () => {
    const layout = baseLayout([{ action: { topic: '/cmd_vel', messageType: 'geometry_msgs/Twist' } }]);
    const issues = validatePadAgainstRos(layout, discovery);
    expect(issues).toEqual([]);
    expect(summarizePadValidation(issues)).toContain('matches the connected robot');
  });

  it('flags a topic the robot no longer publishes', () => {
    const layout = baseLayout([{ action: { topic: '/missing_topic', messageType: 'geometry_msgs/Twist' } }]);
    const issues = validatePadAgainstRos(layout, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('/missing_topic');
    expect(issues[0].severity).toBe('error');
  });

  it('flags a message-type mismatch on an otherwise-existing topic', () => {
    const layout = baseLayout([{ action: { topic: '/cmd_vel', messageType: 'geometry_msgs/TwistStamped' } }]);
    const issues = validatePadAgainstRos(layout, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/expects message type/i);
  });

  it('checks eventOperations bindings (press/release/on/off)', () => {
    const layout = baseLayout([
      {
        eventOperations: {
          press: { kind: 'service', name: '/missing_service', messageType: 'std_srvs/srv/SetBool' },
        },
      },
    ]);
    const issues = validatePadAgainstRos(layout, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('/missing_service');
  });

  it('checks physicalGamepadBindings press/release per control', () => {
    const layout = baseLayout([
      {
        type: 'physical-gamepad',
        config: {
          physicalGamepadBindings: {
            'face-bottom': { press: { kind: 'action', name: '/wrong_action', messageType: 'nav2_msgs/action/NavigateToPose' } },
          },
        },
      },
    ]);
    const issues = validatePadAgainstRos(layout, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('/wrong_action');
    expect(issues[0].message).toContain('face-bottom');
  });

  it('ignores components with no ROS references at all', () => {
    const layout = baseLayout([{}]);
    expect(validatePadAgainstRos(layout, discovery)).toEqual([]);
  });
});
