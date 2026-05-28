import { Edge } from 'reactflow';

import {
  annotateOrderedEdges,
  getOrderedChildLinks,
  isOrderedControlNode,
  moveOrderedChildEdge,
} from './orderUtils';
import { BehaviorNodeData, BehaviorNodeType, BehaviorTreeNode } from './types';

const node = (id: string, type: BehaviorNodeType, label = id): BehaviorTreeNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    label,
    type,
    actionName: '',
    actionType: '',
    serviceName: '',
    serviceType: '',
    topicName: '',
    messageType: '',
  } as BehaviorNodeData,
});

describe('behavior tree order utilities', () => {
  it('treats sequence and selector nodes as ordered parents', () => {
    expect(isOrderedControlNode(node('sequence', BehaviorNodeType.Sequence))).toBe(true);
    expect(isOrderedControlNode(node('selector', BehaviorNodeType.Selector))).toBe(true);
    expect(isOrderedControlNode(node('parallel', BehaviorNodeType.Parallel))).toBe(false);
    expect(isOrderedControlNode(node('action', BehaviorNodeType.Action))).toBe(false);
  });

  it('returns child links in edge order', () => {
    const nodes = [
      node('sequence', BehaviorNodeType.Sequence),
      node('first', BehaviorNodeType.Action, 'First'),
      node('second', BehaviorNodeType.Action, 'Second'),
    ];
    const edges: Edge[] = [
      { id: 'edge-0', source: 'sequence', target: 'second' },
      { id: 'edge-1', source: 'sequence', target: 'first' },
    ];

    expect(getOrderedChildLinks('sequence', nodes, edges).map((link) => link.child.id)).toEqual([
      'second',
      'first',
    ]);
  });

  it('moves one parent child edge without disturbing unrelated edges', () => {
    const edges: Edge[] = [
      { id: 'edge-0', source: 'sequence', target: 'first' },
      { id: 'edge-other', source: 'other', target: 'outside' },
      { id: 'edge-1', source: 'sequence', target: 'second' },
    ];

    const reordered = moveOrderedChildEdge(edges, 'sequence', 'edge-1', -1);

    expect(reordered.map((edge) => edge.id)).toEqual(['edge-1', 'edge-other', 'edge-0']);
  });

  it('annotates ordered control-flow edges with visible order labels', () => {
    const nodes = [
      node('sequence', BehaviorNodeType.Sequence),
      node('first', BehaviorNodeType.Action),
      node('second', BehaviorNodeType.Action),
    ];
    const edges: Edge[] = [
      { id: 'edge-0', source: 'sequence', target: 'first' },
      { id: 'edge-1', source: 'sequence', target: 'second' },
    ];

    expect(annotateOrderedEdges(nodes, edges).map((edge) => edge.label)).toEqual(['1', '2']);
  });
});
