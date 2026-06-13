import { describe, expect, it } from 'vitest';
import { Edge } from 'reactflow';

import { BehaviorNodeType, BehaviorTreeNode, ExecutionStatus } from './types';
import {
  createBehaviorTreeNode,
  duplicateSelectedBehaviorNodes,
  getNextBehaviorNodeId,
  getNodeCounterAfterNodes,
} from './nodeUtils';

describe('behavior tree node utilities', () => {
  it('allocates a unique node id after existing node-N ids', () => {
    const nodes = [
      { id: 'node-0' },
      { id: 'node-1' },
      { id: 'custom-node' },
      { id: 'node-3' },
    ];

    expect(getNodeCounterAfterNodes(nodes)).toBe(4);
    expect(getNextBehaviorNodeId(nodes, getNodeCounterAfterNodes(nodes))).toBe('node-4');
  });

  it('skips occupied ids when the counter is stale after loading a tree', () => {
    const nodes = [{ id: 'node-0' }];

    expect(getNextBehaviorNodeId(nodes, 0)).toBe('node-1');
  });

  it('creates behavior nodes from a shared factory', () => {
    const node = createBehaviorTreeNode({
      id: 'node-7',
      nodeType: BehaviorNodeType.Sequence,
      position: { x: 12, y: 34 },
    });

    expect(node).toMatchObject({
      id: 'node-7',
      type: BehaviorNodeType.Sequence,
      position: { x: 12, y: 34 },
      data: { label: 'Sequence', type: 'sequence' },
    });
  });

  it('uses the ROS action name as the default node name', () => {
    const node = createBehaviorTreeNode({
      id: 'node-8',
      nodeType: BehaviorNodeType.Action,
      position: { x: 0, y: 0 },
      rosInfo: {
        name: '/navigate_to_pose',
        type: 'nav2_msgs/action/NavigateToPose',
        namespace: '/',
      },
    });

    expect(node?.data).toMatchObject({
      label: '/navigate_to_pose',
      actionName: '/navigate_to_pose',
      actionType: 'nav2_msgs/action/NavigateToPose',
    });
  });

  it('duplicates selected nodes with new ids and only selected internal edges', () => {
    const nodes: BehaviorTreeNode[] = [
      {
        id: 'node-0',
        type: BehaviorNodeType.Sequence,
        position: { x: 10, y: 20 },
        selected: true,
        data: { label: 'Sequence', type: 'sequence', status: ExecutionStatus.Success },
      },
      {
        id: 'node-1',
        type: BehaviorNodeType.Selector,
        position: { x: 100, y: 120 },
        selected: true,
        data: { label: 'Selector', type: 'selector' },
      },
      {
        id: 'node-2',
        type: BehaviorNodeType.Action,
        position: { x: 240, y: 120 },
        data: {
          label: 'Action',
          actionName: '/run',
          actionType: 'example_msgs/action/Run',
        },
      },
    ];
    const edges: Edge[] = [
      { id: 'edge-0', source: 'node-0', target: 'node-1' },
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ];

    const result = duplicateSelectedBehaviorNodes({
      nodes,
      edges,
      selectedNodeIds: ['node-0', 'node-1'],
    });

    expect(result.duplicatedNodes.map((node) => node.id)).toEqual(['node-3', 'node-4']);
    expect(result.duplicatedNodes[0].position).toEqual({ x: 50, y: 60 });
    expect(result.duplicatedNodes[0].data.status).toBeUndefined();
    expect(result.nodes).toHaveLength(5);
    expect(result.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      'node-3',
      'node-4',
    ]);
    expect(result.duplicatedEdges).toHaveLength(1);
    expect(result.duplicatedEdges[0]).toMatchObject({
      id: 'edge-2',
      source: 'node-3',
      target: 'node-4',
    });
    expect(result.edges).toHaveLength(3);
    expect(result.nextNodeCounter).toBe(5);
  });
});
