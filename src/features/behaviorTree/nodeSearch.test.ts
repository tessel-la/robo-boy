import { describe, expect, it } from 'vitest';

import { searchBehaviorTreeNodes } from './nodeSearch';
import { BehaviorNodeType, BehaviorTreeNode } from './types';

const nodes: BehaviorTreeNode[] = [
  {
    id: 'node-0',
    type: BehaviorNodeType.Sequence,
    position: { x: 0, y: 0 },
    data: { label: 'Mission Sequence', type: 'sequence' },
  },
  {
    id: 'node-1',
    type: BehaviorNodeType.Action,
    position: { x: 100, y: 100 },
    data: {
      label: 'Navigate Home',
      actionName: '/navigate_to_pose',
      actionType: 'nav2_msgs/action/NavigateToPose',
    },
  },
  {
    id: 'node-2',
    type: BehaviorNodeType.Service,
    position: { x: 200, y: 100 },
    data: {
      label: 'Reset Map',
      serviceName: '/map/reset',
      serviceType: 'std_srvs/srv/Empty',
    },
  },
];

describe('behavior tree node search', () => {
  it('matches visible labels case-insensitively', () => {
    expect(searchBehaviorTreeNodes(nodes, 'MISSION')).toMatchObject([
      { node: { id: 'node-0' }, label: 'Mission Sequence', typeLabel: 'Sequence' },
    ]);
  });

  it('matches ROS resource names and multiple terms', () => {
    expect(searchBehaviorTreeNodes(nodes, 'navigate pose')).toMatchObject([
      {
        node: { id: 'node-1' },
        label: 'Navigate Home',
        detail: '/navigate_to_pose',
        typeLabel: 'Action',
      },
    ]);
  });

  it('returns no results for an empty or unmatched query', () => {
    expect(searchBehaviorTreeNodes(nodes, '   ')).toEqual([]);
    expect(searchBehaviorTreeNodes(nodes, 'dock robot')).toEqual([]);
  });
});
