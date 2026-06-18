import { Edge } from 'reactflow';

import {
  cloneBehaviorTree,
  explodeSubtreeNode,
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

  it('stores wrapped nodes in local subtree coordinates and restores them on explode', () => {
    const sequence = {
      ...makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence'),
      position: { x: 100, y: 50 },
    };
    const first = {
      ...makeNode('first', BehaviorNodeType.Action, 'First'),
      position: { x: 20, y: 200 },
    };
    const second = {
      ...makeNode('second', BehaviorNodeType.Action, 'Second'),
      position: { x: 220, y: 200 },
    };
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const wrapped = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;
    expect(wrapped.subtreeNode.position).toEqual({ x: 120, y: 200 });
    expect(isSubtreeNode(wrapped.subtreeNode)).toBe(true);
    if (!isSubtreeNode(wrapped.subtreeNode)) return;

    const embeddedNodes = wrapped.subtreeNode.data.tree.nodes;
    const generatedRoot = embeddedNodes.find(
      (node) => 'generatedBySubtreeWrap' in node.data && node.data.generatedBySubtreeWrap
    );
    expect(embeddedNodes.find((node) => node.id === 'first')?.position).toEqual({ x: -100, y: 0 });
    expect(embeddedNodes.find((node) => node.id === 'second')?.position).toEqual({ x: 100, y: 0 });
    expect(generatedRoot?.position).toEqual({ x: -20, y: -150 });

    const exploded = explodeSubtreeNode({
      tree: wrapped.tree,
      subtreeNodeId: 'subtree-node',
      startNodeIndex: 10,
    });

    expect(exploded.ok).toBe(true);
    if (!exploded.ok) return;
    expect(exploded.tree.nodes.find((node) => node.data.label === 'First')?.position).toEqual(first.position);
    expect(exploded.tree.nodes.find((node) => node.data.label === 'Second')?.position).toEqual(second.position);
  });

  it('keeps nested subtree layouts local when a subtree is wrapped again', () => {
    const sequence = {
      ...makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence'),
      position: { x: 0, y: 0 },
    };
    const first = {
      ...makeNode('first', BehaviorNodeType.Action, 'First'),
      position: { x: 0, y: 160 },
    };
    const second = {
      ...makeNode('second', BehaviorNodeType.Action, 'Second'),
      position: { x: 240, y: 160 },
    };
    const third = {
      ...makeNode('third', BehaviorNodeType.Action, 'Third'),
      position: { x: 480, y: 160 },
    };
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second, third],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
        { id: 'edge-2', source: 'sequence', target: 'third' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const inner = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'inner-subtree',
      subtreeTreeId: 'inner-tree',
      subtreeLabel: 'Inner',
    });
    expect(inner.ok).toBe(true);
    if (!inner.ok) return;

    const outer = wrapSelectionIntoSubtree({
      tree: inner.tree,
      selectedNodeIds: ['inner-subtree', 'third'],
      subtreeNodeId: 'outer-subtree',
      subtreeTreeId: 'outer-tree',
      subtreeLabel: 'Outer',
    });
    expect(outer.ok).toBe(true);
    if (!outer.ok) return;
    expect(isSubtreeNode(outer.subtreeNode)).toBe(true);
    if (!isSubtreeNode(outer.subtreeNode)) return;

    const outerEmbeddedNodes = outer.subtreeNode.data.tree.nodes;
    const embeddedInner = outerEmbeddedNodes.find((node) => node.id === 'inner-subtree');
    const embeddedThird = outerEmbeddedNodes.find((node) => node.id === 'third');
    expect(embeddedInner?.position).toEqual({ x: -180, y: 0 });
    expect(embeddedThird?.position).toEqual({ x: 180, y: 0 });

    const outerGeneratedRoot = outerEmbeddedNodes.find(
      (node) => 'generatedBySubtreeWrap' in node.data && node.data.generatedBySubtreeWrap
    );
    const orderedOuterChildren = outer.subtreeNode.data.tree.edges
      .filter((edge) => edge.source === outerGeneratedRoot?.id)
      .map((edge) => edge.target);
    expect(orderedOuterChildren).toEqual(['inner-subtree', 'third']);

    expect(isSubtreeNode(embeddedInner)).toBe(true);
    if (!isSubtreeNode(embeddedInner)) return;
    expect(embeddedInner.data.tree.nodes.find((node) => node.id === 'first')?.position).toEqual({
      x: -120,
      y: 0,
    });
    expect(embeddedInner.data.tree.nodes.find((node) => node.id === 'second')?.position).toEqual({
      x: 120,
      y: 0,
    });
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

  it('wraps selected children when their parent is also partially selected', () => {
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
      selectedNodeIds: ['sequence', 'first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tree.nodes.map((node) => node.id)).toContain('sequence');
    expect(result.tree.edges.filter((edge) => edge.source === 'sequence').map((edge) => edge.target)).toEqual([
      'subtree-node',
      'third',
    ]);
  });

  it('wraps the highest selected parent when all of its children are selected', () => {
    const root = makeNode('root-sequence', BehaviorNodeType.Sequence, 'Root');
    const childSequence = makeNode('child-sequence', BehaviorNodeType.Sequence, 'Child');
    const first = makeNode('first', BehaviorNodeType.Action, 'First');
    const second = makeNode('second', BehaviorNodeType.Action, 'Second');
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [root, childSequence, first, second],
      edges: [
        { id: 'edge-0', source: 'root-sequence', target: 'child-sequence' },
        { id: 'edge-1', source: 'child-sequence', target: 'first' },
        { id: 'edge-2', source: 'child-sequence', target: 'second' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const result = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['child-sequence', 'first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tree.nodes.map((node) => node.id)).not.toContain('child-sequence');
    expect(result.tree.edges.filter((edge) => edge.source === 'root-sequence').map((edge) => edge.target)).toEqual([
      'subtree-node',
    ]);
    expect(isSubtreeNode(result.subtreeNode)).toBe(true);
    if (!isSubtreeNode(result.subtreeNode)) return;
    expect(result.subtreeNode.data.tree.nodes.map((node) => node.id)).toContain('child-sequence');
  });

  it('wraps selected branches with descendants across multiple levels', () => {
    const root = makeNode('root', BehaviorNodeType.Sequence, 'Root');
    const firstBranch = makeNode('first-branch', BehaviorNodeType.Sequence, 'First Branch');
    const secondBranch = makeNode('second-branch', BehaviorNodeType.Sequence, 'Second Branch');
    const firstLeaf = makeNode('first-leaf', BehaviorNodeType.Action, 'First Leaf');
    const secondLeaf = makeNode('second-leaf', BehaviorNodeType.Action, 'Second Leaf');
    const firstGrandchild = makeNode('first-grandchild', BehaviorNodeType.Action, 'First Grandchild');
    const secondGrandchild = makeNode('second-grandchild', BehaviorNodeType.Action, 'Second Grandchild');
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [
        root,
        firstBranch,
        secondBranch,
        firstLeaf,
        secondLeaf,
        firstGrandchild,
        secondGrandchild,
      ],
      edges: [
        { id: 'edge-0', source: 'root', target: 'first-branch' },
        { id: 'edge-1', source: 'root', target: 'second-branch' },
        { id: 'edge-2', source: 'first-branch', target: 'first-leaf' },
        { id: 'edge-3', source: 'second-branch', target: 'second-leaf' },
        { id: 'edge-4', source: 'first-leaf', target: 'first-grandchild' },
        { id: 'edge-5', source: 'second-leaf', target: 'second-grandchild' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const result = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: [
        'first-branch',
        'second-branch',
        'first-leaf',
        'second-leaf',
        'first-grandchild',
        'second-grandchild',
      ],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.selectedRootIds).toEqual(['first-branch', 'second-branch']);
    expect(result.tree.edges.filter((edge) => edge.source === 'root').map((edge) => edge.target)).toEqual([
      'subtree-node',
    ]);
  });

  it('explodes generated wrap roots without recreating the wrapper sequence', () => {
    const sequence = makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence');
    const first = makeNode('first', BehaviorNodeType.Action, 'First');
    const second = makeNode('second', BehaviorNodeType.Action, 'Second');
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const wrapped = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const exploded = explodeSubtreeNode({
      tree: wrapped.tree,
      subtreeNodeId: 'subtree-node',
      startNodeIndex: 10,
    });

    expect(exploded.ok).toBe(true);
    if (!exploded.ok) return;

    const insertedSequences = exploded.tree.nodes.filter(
      (node) => node.type === BehaviorNodeType.Sequence && node.id !== 'sequence'
    );
    expect(insertedSequences).toHaveLength(0);
    expect(exploded.insertedNodeIds).toHaveLength(2);
  });

  it('preserves parent edge order when exploding a wrapped branch', () => {
    const sequence = makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence');
    const first = makeNode('first', BehaviorNodeType.Action, 'First');
    const second = makeNode('second', BehaviorNodeType.Action, 'Second');
    const third = makeNode('third', BehaviorNodeType.Action, 'Third');
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second, third],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
        { id: 'edge-2', source: 'sequence', target: 'third' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const wrapped = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const exploded = explodeSubtreeNode({
      tree: wrapped.tree,
      subtreeNodeId: 'subtree-node',
      startNodeIndex: 10,
    });

    expect(exploded.ok).toBe(true);
    if (!exploded.ok) return;

    const childLabels = exploded.tree.edges
      .filter((edge) => edge.source === 'sequence')
      .map((edge) => exploded.tree.nodes.find((node) => node.id === edge.target)?.data.label);
    expect(childLabels).toEqual(['First', 'Second', 'Third']);
  });

  it('restores wrapped node positions when an unchanged subtree is exploded', () => {
    const sequence = {
      ...makeNode('sequence', BehaviorNodeType.Sequence, 'Sequence'),
      position: { x: 0, y: 0 },
    };
    const first = {
      ...makeNode('first', BehaviorNodeType.Action, 'First'),
      position: { x: 120, y: 160 },
    };
    const second = {
      ...makeNode('second', BehaviorNodeType.Action, 'Second'),
      position: { x: 420, y: 260 },
    };
    const tree: BehaviorTree = {
      id: 'root',
      name: 'Root',
      nodes: [sequence, first, second],
      edges: [
        { id: 'edge-0', source: 'sequence', target: 'first' },
        { id: 'edge-1', source: 'sequence', target: 'second' },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const wrapped = wrapSelectionIntoSubtree({
      tree,
      selectedNodeIds: ['first', 'second'],
      subtreeNodeId: 'subtree-node',
      subtreeTreeId: 'subtree-tree',
      subtreeLabel: 'Wrapped',
    });

    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const exploded = explodeSubtreeNode({
      tree: wrapped.tree,
      subtreeNodeId: 'subtree-node',
      startNodeIndex: 10,
    });

    expect(exploded.ok).toBe(true);
    if (!exploded.ok) return;

    expect(exploded.tree.nodes.find((node) => node.data.label === 'First')?.position).toEqual(first.position);
    expect(exploded.tree.nodes.find((node) => node.data.label === 'Second')?.position).toEqual(second.position);
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
