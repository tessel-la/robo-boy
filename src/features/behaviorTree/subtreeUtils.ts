import { Edge, Node, XYPosition } from 'reactflow';

import { getNextBehaviorNodeId, getNodeCounterAfterNodes } from './nodeUtils';
import {
  BehaviorNodeType,
  BehaviorTree,
  BehaviorTreeNode,
  ExecutionStatus,
  SubtreeNodeData,
} from './types';

const deepClone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export const isSubtreeNode = (
  node?: Pick<BehaviorTreeNode, 'type' | 'data'> | null
): node is BehaviorTreeNode & { data: SubtreeNodeData } => {
  return Boolean(node?.type === BehaviorNodeType.Subtree && node.data && 'tree' in node.data);
};

export const cloneBehaviorTree = (tree: BehaviorTree): BehaviorTree => deepClone(tree);

export const areTreePathsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((segment, index) => segment === right[index]);
};

export const getTreeAtPath = (rootTree: BehaviorTree, path: string[]): BehaviorTree | null => {
  let currentTree: BehaviorTree = rootTree;

  for (const nodeId of path) {
    const subtreeNode = currentTree.nodes.find((node) => node.id === nodeId);
    if (!isSubtreeNode(subtreeNode)) return null;
    currentTree = subtreeNode.data.tree;
  }

  return currentTree;
};

export const replaceTreeAtPath = (
  rootTree: BehaviorTree,
  path: string[],
  nextTree: BehaviorTree
): BehaviorTree => {
  if (path.length === 0) {
    return nextTree;
  }

  const [currentNodeId, ...remainingPath] = path;
  return {
    ...rootTree,
    nodes: rootTree.nodes.map((node) => {
      if (node.id !== currentNodeId || !isSubtreeNode(node)) return node;

      return {
        ...node,
        data: {
          ...node.data,
          tree: replaceTreeAtPath(node.data.tree, remainingPath, nextTree),
        },
      };
    }),
  };
};

export const updateTreeAtPath = (
  rootTree: BehaviorTree,
  path: string[],
  updater: (tree: BehaviorTree) => BehaviorTree
): BehaviorTree => {
  const targetTree = path.length === 0 ? rootTree : getTreeAtPath(rootTree, path);
  if (!targetTree) return rootTree;

  const nextTree = updater(targetTree);
  return path.length === 0 ? nextTree : replaceTreeAtPath(rootTree, path, nextTree);
};

export const resetBehaviorTreeExecutionState = (tree: BehaviorTree): BehaviorTree => ({
  ...tree,
  nodes: tree.nodes.map((node) => {
    const baseNode = {
      ...node,
      data: {
        ...node.data,
        status: ExecutionStatus.Idle,
      },
    };

    if (!isSubtreeNode(node)) return baseNode;

    return {
      ...baseNode,
      data: {
        ...baseNode.data,
        tree: resetBehaviorTreeExecutionState(node.data.tree),
      },
    };
  }),
});

export const syncReferencedSubtrees = (
  tree: BehaviorTree,
  sourceTree: BehaviorTree
): BehaviorTree => {
  let didChange = false;

  const nextNodes = tree.nodes.map((node) => {
    if (!isSubtreeNode(node)) return node;

    const syncedNestedTree = syncReferencedSubtrees(node.data.tree, sourceTree);
    const referencesSource = node.data.sourceTreeId === sourceTree.id;

    if (referencesSource) {
      didChange = true;
      return {
        ...node,
        data: {
          ...node.data,
          label: sourceTree.name,
          sourceTreeId: sourceTree.id,
          tree: cloneBehaviorTree(sourceTree),
        },
      };
    }

    if (syncedNestedTree !== node.data.tree) {
      didChange = true;
      return {
        ...node,
        data: {
          ...node.data,
          tree: syncedNestedTree,
        },
      };
    }

    return node;
  });

  return didChange
    ? {
        ...tree,
        nodes: nextNodes,
        updatedAt: Date.now(),
      }
    : tree;
};

export interface ExplodeSubtreeNodeParams {
  tree: BehaviorTree;
  subtreeNodeId: string;
  startNodeIndex?: number;
}

export type ExplodeSubtreeNodeResult = {
  ok: true;
  tree: BehaviorTree;
  insertedNodeIds: string[];
  nextNodeCounter: number;
} | {
  ok: false;
  reason: string;
};

export const createSubtreeNode = ({
  id,
  label,
  position,
  tree,
  sourceTreeId,
}: {
  id: string;
  label: string;
  position: XYPosition;
  tree: BehaviorTree;
  sourceTreeId?: string;
}): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Subtree,
  position,
  data: {
    label,
    tree: cloneBehaviorTree(tree),
    sourceTreeId,
  },
});

const collectDescendantIds = (
  tree: Pick<BehaviorTree, 'nodes' | 'edges'>,
  rootIds: string[]
): Set<string> => {
  const ids = new Set(rootIds);
  const queue = [...rootIds];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;

    tree.edges
      .filter((edge) => edge.source === currentId)
      .forEach((edge) => {
        if (ids.has(edge.target)) return;
        ids.add(edge.target);
        queue.push(edge.target);
      });
  }

  return ids;
};

const averagePosition = (nodes: BehaviorTreeNode[]): XYPosition => {
  if (nodes.length === 0) return { x: 0, y: 0 };

  const { x, y } = nodes.reduce(
    (acc, node) => ({
      x: acc.x + node.position.x,
      y: acc.y + node.position.y,
    }),
    { x: 0, y: 0 }
  );

  return {
    x: x / nodes.length,
    y: y / nodes.length,
  };
};

export interface WrapSelectionIntoSubtreeParams {
  tree: BehaviorTree;
  selectedNodeIds: string[];
  subtreeTreeId: string;
  subtreeLabel: string;
  subtreeNodeId: string;
}

export type WrapSelectionIntoSubtreeResult = {
  ok: true;
  tree: BehaviorTree;
  subtreeNode: BehaviorTreeNode;
  selectedRootIds: string[];
} | {
  ok: false;
  reason: string;
};

export const wrapSelectionIntoSubtree = ({
  tree,
  selectedNodeIds,
  subtreeTreeId,
  subtreeLabel,
  subtreeNodeId,
}: WrapSelectionIntoSubtreeParams): WrapSelectionIntoSubtreeResult => {
  if (selectedNodeIds.length < 2) {
    return { ok: false, reason: 'Select at least two nodes to wrap them in a subtree.' };
  }

  const selectedIds = new Set(selectedNodeIds);
  const selectedNodes = tree.nodes.filter((node) => selectedIds.has(node.id));
  if (selectedNodes.length !== selectedIds.size) {
    return { ok: false, reason: 'Some selected nodes could not be found.' };
  }

  const selectedRoots = selectedNodes.filter(
    (node) => !tree.edges.some((edge) => selectedIds.has(edge.source) && edge.target === node.id)
  );
  if (selectedRoots.length < 2) {
    return {
      ok: false,
      reason: 'Select sibling sequence items, not just nested nodes from one branch.',
    };
  }

  const incomingParentEdges = selectedRoots.map((node) =>
    tree.edges.find((edge) => edge.target === node.id)
  );
  if (incomingParentEdges.some((edge) => !edge)) {
    return {
      ok: false,
      reason: 'Selected nodes must already be attached to the same sequence before wrapping.',
    };
  }

  const parentIds = Array.from(new Set(incomingParentEdges.map((edge) => edge?.source)));
  if (parentIds.length !== 1) {
    return {
      ok: false,
      reason: 'Selected nodes must share the same parent sequence to wrap them.',
    };
  }

  const parentNode = tree.nodes.find((node) => node.id === parentIds[0]);
  if (!parentNode || parentNode.type !== BehaviorNodeType.Sequence) {
    return {
      ok: false,
      reason: 'Only children of a sequence node can be wrapped into a subtree.',
    };
  }

  const siblingEdges = tree.edges.filter((edge) => edge.source === parentNode.id);
  const selectedSiblingIndexes = siblingEdges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => selectedRoots.some((node) => node.id === edge.target))
    .map(({ index }) => index);

  const sortedIndexes = [...selectedSiblingIndexes].sort((a, b) => a - b);
  const isContiguous = sortedIndexes.every((index, offset) => {
    return offset === 0 || index === sortedIndexes[offset - 1] + 1;
  });

  if (!isContiguous) {
    return {
      ok: false,
      reason: 'Wrap works on consecutive sequence items. Select neighboring children and try again.',
    };
  }

  const includedIds = collectDescendantIds(tree, selectedRoots.map((node) => node.id));
  const subtreeNodes = tree.nodes
    .filter((node) => includedIds.has(node.id))
    .map((node) => ({
      ...deepClone(node),
      selected: false,
      dragging: false,
      data: {
        ...deepClone(node.data),
        status: undefined,
        isHighlighted: false,
      },
    }));

  const internalEdges = tree.edges
    .filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target))
    .map((edge) => ({
      ...deepClone(edge),
      selected: false,
    }));

  const subtreeSequenceRootId = getNextBehaviorNodeId(
    subtreeNodes as Array<Pick<Node, 'id'>>,
    0
  );
  const subtreeSequenceRoot: BehaviorTreeNode = {
    id: subtreeSequenceRootId,
    type: BehaviorNodeType.Sequence,
    position: averagePosition(selectedRoots),
    data: {
      label: subtreeLabel,
      type: 'sequence',
    },
  };

  const subtreeEdgeSeed = internalEdges.length;
  const rootEdges: Edge[] = selectedRoots.map((node, index) => ({
    id: `edge-subtree-${subtreeTreeId}-${subtreeEdgeSeed + index}`,
    source: subtreeSequenceRoot.id,
    target: node.id,
    sourceHandle: null,
    targetHandle: null,
    selected: false,
  }));

  const embeddedTree: BehaviorTree = {
    id: subtreeTreeId,
    name: subtreeLabel,
    nodes: [...subtreeNodes, subtreeSequenceRoot],
    edges: [...rootEdges, ...internalEdges],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const subtreeNode = createSubtreeNode({
    id: subtreeNodeId,
    label: subtreeLabel,
    position: averagePosition(selectedRoots),
    tree: embeddedTree,
  });

  const nextNodes = [
    ...tree.nodes.filter((node) => !includedIds.has(node.id)).map((node) => ({
      ...node,
      selected: false,
      dragging: false,
      data: {
        ...node.data,
        isHighlighted: false,
      },
    })),
    subtreeNode,
  ];

  let insertedParentEdge = false;
  const nextEdges = tree.edges.flatMap((edge) => {
    if (includedIds.has(edge.source) || includedIds.has(edge.target)) {
      if (
        !insertedParentEdge &&
        edge.source === parentNode.id &&
        selectedRoots.some((node) => node.id === edge.target)
      ) {
        insertedParentEdge = true;
        return [
          {
            id: `edge-parent-${subtreeNode.id}`,
            source: parentNode.id,
            target: subtreeNode.id,
            sourceHandle: null,
            targetHandle: null,
            selected: false,
          } satisfies Edge,
        ];
      }

      return [];
    }

    return [{ ...edge, selected: false }];
  });

  return {
    ok: true,
    tree: {
      ...tree,
      nodes: nextNodes,
      edges: nextEdges,
      updatedAt: Date.now(),
    },
    subtreeNode,
    selectedRootIds: selectedRoots.map((node) => node.id),
  };
};

export const explodeSubtreeNode = ({
  tree,
  subtreeNodeId,
  startNodeIndex = 0,
}: ExplodeSubtreeNodeParams): ExplodeSubtreeNodeResult => {
  const subtreeNode = tree.nodes.find((node) => node.id === subtreeNodeId);
  if (!isSubtreeNode(subtreeNode)) {
    return {
      ok: false,
      reason: 'Select a subtree node to expand it back into the current tree.',
    };
  }

  const embeddedTree = cloneBehaviorTree(subtreeNode.data.tree);
  if (embeddedTree.nodes.length === 0) {
    return {
      ok: false,
      reason: 'This subtree is empty, so there is nothing to expand.',
    };
  }

  const nodesWithIncoming = new Set(embeddedTree.edges.map((edge) => edge.target));
  const nodesWithOutgoing = new Set(embeddedTree.edges.map((edge) => edge.source));
  const embeddedRoots = embeddedTree.nodes.filter((node) => !nodesWithIncoming.has(node.id));
  const embeddedLeaves = embeddedTree.nodes.filter((node) => !nodesWithOutgoing.has(node.id));

  if (embeddedRoots.length === 0) {
    return {
      ok: false,
      reason: 'This subtree has no root node to reconnect.',
    };
  }

  const anchor = averagePosition(embeddedRoots);
  const allocationNodes: Array<Pick<Node, 'id'>> = tree.nodes.filter((node) => node.id !== subtreeNodeId);
  let nextNodeCounter = getNodeCounterAfterNodes(allocationNodes, startNodeIndex);
  const idMap = new Map<string, string>();

  const clonedNodes = embeddedTree.nodes.map((node) => {
    const nextId = getNextBehaviorNodeId(allocationNodes, nextNodeCounter);
    nextNodeCounter = getNodeCounterAfterNodes([{ id: nextId }], nextNodeCounter);
    allocationNodes.push({ id: nextId });
    idMap.set(node.id, nextId);

    return {
      ...deepClone(node),
      id: nextId,
      position: {
        x: subtreeNode.position.x + (node.position.x - anchor.x),
        y: subtreeNode.position.y + (node.position.y - anchor.y),
      },
      selected: true,
      dragging: false,
      data: {
        ...deepClone(node.data),
        isHighlighted: true,
      },
    };
  });

  const internalEdges = embeddedTree.edges.map((edge) => ({
    ...deepClone(edge),
    id: `edge-expand-${subtreeNode.id}-${crypto.randomUUID()}`,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
    selected: false,
  }));

  const incomingEdges = tree.edges.filter((edge) => edge.target === subtreeNode.id);
  const outgoingEdges = tree.edges.filter((edge) => edge.source === subtreeNode.id);
  const reconnectedIncomingEdges = incomingEdges.flatMap((edge) =>
    embeddedRoots.map((root) => ({
      ...deepClone(edge),
      id: `edge-expand-in-${subtreeNode.id}-${crypto.randomUUID()}`,
      target: idMap.get(root.id) ?? root.id,
      selected: false,
    }))
  );
  const reconnectedOutgoingEdges = outgoingEdges.flatMap((edge) =>
    embeddedLeaves.map((leaf) => ({
      ...deepClone(edge),
      id: `edge-expand-out-${subtreeNode.id}-${crypto.randomUUID()}`,
      source: idMap.get(leaf.id) ?? leaf.id,
      selected: false,
    }))
  );

  const nextNodes = [
    ...tree.nodes
      .filter((node) => node.id !== subtreeNode.id)
      .map((node) => ({
        ...node,
        selected: false,
        dragging: false,
        data: {
          ...node.data,
          isHighlighted: false,
        },
      })),
    ...clonedNodes,
  ];
  const nextEdges = [
    ...tree.edges.filter((edge) => edge.source !== subtreeNode.id && edge.target !== subtreeNode.id),
    ...internalEdges,
    ...reconnectedIncomingEdges,
    ...reconnectedOutgoingEdges,
  ];

  return {
    ok: true,
    tree: {
      ...tree,
      nodes: nextNodes,
      edges: nextEdges,
      updatedAt: Date.now(),
    },
    insertedNodeIds: clonedNodes.map((node) => node.id),
    nextNodeCounter,
  };
};
