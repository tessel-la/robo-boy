import { Edge } from 'reactflow';

import {
  cloneBehaviorTree,
  getTreeAtPath,
  isSubtreeNode,
  replaceTreeAtPath,
  wrapSelectionIntoSubtree,
} from './subtreeUtils';
import { BehaviorNodeType, BehaviorTree, BehaviorTreeNode } from './types';

const makeNode = (id: string, type: BehaviorNodeType, label = id): BehaviorTreeNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data:
    type === BehaviorNodeType.Sequence
      ? { label, type: 'sequence' }
      : type === BehaviorNodeType.Subtree
        ? {
            label,
            tree: {
              id: `${id}-tree`,
              name: label,
              nodes: [],
              edges: [],
              createdAt: 1,
              updatedAt: 1,
            },
          }
        : {
            label,
            actionName: label,
            actionType: 'example_msgs/action/Test',
          },
});

describe('subtree utilities', () => {
  it('reads and replaces a nested tree by path', () => {
    const nested: BehaviorTree = {
      id: 'nested',
      name: 'Nested',
      nodes: [makeNode('leaf', BehaviorNodeType.Action)],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const root: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [
        {
          ...makeNode('sub', BehaviorNodeType.Subtree, 'Sub'),
          data: { label: 'Sub', tree: nested },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    };

    expect(getTreeAtPath(root, ['sub'])?.id).toBe('nested');

    const replacement = replaceTreeAtPath(root, ['sub'], {
      ...nested,
      name: 'Updated',
    });
    expect(getTreeAtPath(replacement, ['sub'])?.name).toBe('Updated');
  });

  it('wraps consecutive sequence children into a subtree snapshot', () => {
    const sequence = makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence');
    const first = makeNode('first', BehaviorNodeType.Action, 'First');
    const second = makeNode('second', BehaviorNodeType.Action, 'Second');
    const trailing = makeNode('trailing', BehaviorNodeType.Action, 'Trailing');
    const firstChild = makeNode('first-child', BehaviorNodeType.Action, 'Child');
    const edges: Edge[] = [
      { id: 'edge-0', source: 'sequence', target: 'first' },
      { id: 'edge-1', source: 'sequence', target: 'second' },
      { id: 'edge-2', source: 'sequence', target: 'trailing' },
      { id: 'edge-3', source: 'first', target: 'first-child' },
    ];

    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second, trailing, firstChild],
      edges,
      createdAt: 1,
      updatedAt: 1,
    };

    const result = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tree.nodes.map((node) => node.id)).toContain('subtree-node');
    expect(result.tree.nodes.map((node) => node.id)).not.toContain('first');
    expect(result.tree.nodes.map((node) => node.id)).not.toContain('second');
    expect(result.tree.nodes.map((node) => node.id)).not.toContain('first-child');
    expect(result.tree.edges.filter((edge) => edge.source === 'sequence').map((edge) => edge.target)).toEqual([
      'subtree-node',
      'trailing',
    ]);
    expect(isSubtreeNode(result.subtreeNode)).toBe(true);
    if (!isSubtreeNode(result.subtreeNode)) return;

    expect(result.subtreeNode.data.tree.nodes.some((node) => node.id === 'first')).toBe(true);
    expect(result.subtreeNode.data.tree.nodes.some((node) => node.id === 'second')).toBe(true);
    expect(result.subtreeNode.data.tree.nodes.some((node) => node.id === 'first-child')).toBe(true);
  });

  it('rejects non-consecutive sequence selections', () => {
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [
        makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence'),
        makeNode('first', BehaviorNodeType.Action, 'First'),
        makeNode('second', BehaviorNodeType.Action, 'Second'),
        makeNode('third', BehaviorNodeType.Action, 'Third'),
      ],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
        { id: 'edge-2', source: 'sequence', target: 'third' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const result = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'third'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(result.ok).toBe(false);
  });

  it('clones behavior trees without mutating the source', () => {
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [makeNode('action', BehaviorNodeType.Action)],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const cloned = cloneBehaviorTree(tree);
    cloned.name = 'Changed';
    expect(tree.name).toBe('Root');
  });
});
