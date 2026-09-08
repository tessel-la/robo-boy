import { describe, expect, it } from 'vitest';
import { validateRosActionProposal } from './rosActionValidator';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';

const discovery: ROSDiscoveryResult = {
  topics: [{ name: '/cmd_vel', type: 'geometry_msgs/Twist' }],
  services: [{ name: '/set_bool', type: 'std_srvs/srv/SetBool' }],
  actions: [{ name: '/navigate', type: 'nav2_msgs/action/NavigateToPose', namespace: '/navigate' }],
};

describe('validateRosActionProposal', () => {
  it('accepts a proposal matching a live topic', () => {
    expect(validateRosActionProposal({ kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist' }, discovery)).toEqual([]);
  });

  it('rejects a hallucinated topic name', () => {
    const issues = validateRosActionProposal({ kind: 'topic', name: '/does_not_exist', messageType: 'geometry_msgs/Twist' }, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('/does_not_exist');
  });

  it('rejects a message-type mismatch on an existing topic', () => {
    const issues = validateRosActionProposal({ kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/TwistStamped' }, discovery);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('geometry_msgs/Twist');
  });

  it('checks services and actions against their own lists, not topics', () => {
    expect(validateRosActionProposal({ kind: 'service', name: '/set_bool', messageType: 'std_srvs/srv/SetBool' }, discovery)).toEqual([]);
    expect(validateRosActionProposal({ kind: 'service', name: '/cmd_vel', messageType: 'geometry_msgs/Twist' }, discovery)).toHaveLength(1);
    expect(validateRosActionProposal({ kind: 'action', name: '/navigate', messageType: 'nav2_msgs/action/NavigateToPose' }, discovery)).toEqual([]);
  });
});
