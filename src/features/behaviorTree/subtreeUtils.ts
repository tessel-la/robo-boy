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

const translatePosition = (position: XYPosition, origin: XYPosition): XYPosition => ({
  x: position.x - origin.x,
  y: position.y - origin.y,
});

const isControlFlowNode = (node?: BehaviorTreeNode | null): boolean => {
  return Boolean(
    node?.type === BehaviorNodeType.Sequence ||
      node?.type === BehaviorNodeType.Selector ||
      node?.type === BehaviorNodeType.Parallel ||
      node?.type === BehaviorNodeType.Retry ||
      node?.type === BehaviorNodeType.Repeat
  );
};

const getChildEdges = (tree: Pick<BehaviorTree, 'edges'>, nodeId: string): Edge[] => {
  return tree.edges.filter((edge) => edge.source === nodeId);
};

const getIncomingEdge = (tree: Pick<BehaviorTree, 'edges'>, nodeId: string): Edge | undefined => {
  return tree.edges.find((edge) => edge.target === nodeId);
};

const hasSelectedDirectChild = (
  tree: Pick<BehaviorTree, 'edges'>,
  nodeId: string,
  selectedIds: Set<string>
): boolean => {
  return getChildEdges(tree, nodeId).some((edge) => selectedIds.has(edge.target));
};

const hasAllDirectChildrenSelected = (
  tree: Pick<BehaviorTree, 'edges'>,
  nodeId: string,
  selectedIds: Set<string>
): boolean => {
  const childEdges = getChildEdges(tree, nodeId);
  return childEdges.length > 0 && childEdges.every((edge) => selectedIds.has(edge.target));
};

const hasAbsorbingSelectedAncestor = (
  tree: Pick<BehaviorTree, 'edges'>,
  nodeId: string,
  selectedIds: Set<string>
): boolean => {
  let currentId = nodeId;
  let incomingEdge = getIncomingEdge(tree, currentId);

  while (incomingEdge) {
    const parentId = incomingEdge.source;
    if (selectedIds.has(parentId) && hasAllDirectChildrenSelected(tree, parentId, selectedIds)) {
      return true;
    }

    currentId = parentId;
    incomingEdge = getIncomingEdge(tree, currentId);
  }

  return false;
};

const getWrapRootNodes = (
  tree: BehaviorTree,
  selectedNodes: BehaviorTreeNode[],
  selectedIds: Set<string>
): BehaviorTreeNode[] => {
  return selectedNodes.filter((node) => {
    if (hasAbsorbingSelectedAncestor(tree, node.id, selectedIds)) return false;

    const hasSelectedChildren = hasSelectedDirectChild(tree, node.id, selectedIds);
    if (hasSelectedChildren && !hasAllDirectChildrenSelected(tree, node.id, selectedIds)) {
      return false;
    }

    return true;
  });
};

const isGeneratedSubtreeRoot = (node: BehaviorTreeNode): boolean => {
  return Boolean(
    node.type === BehaviorNodeType.Sequence &&
      'generatedBySubtreeWrap' in node.data &&
      node.data.generatedBySubtreeWrap
  );
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

  const selectedRoots = getWrapRootNodes(tree, selectedNodes, selectedIds);
  if (selectedRoots.length === 0) {
    return {
      ok: false,
      reason: 'Select neighboring children, or select a parent together with all of its children.',
    };
  }

  const incomingParentEdges = selectedRoots.map((node) => getIncomingEdge(tree, node.id));
  const rootsWithoutParent = incomingParentEdges.filter((edge) => !edge).length;
  if (rootsWithoutParent > 0 && rootsWithoutParent !== incomingParentEdges.length) {
    return {
      ok: false,
      reason: 'Selected nodes must be attached to the same parent before wrapping.',
    };
  }

  const parentIds = Array.from(
    new Set(incomingParentEdges.map((edge) => edge?.source).filter(Boolean))
  );
  if (parentIds.length > 1) {
    return {
      ok: false,
      reason: 'Selected nodes must share the same parent to wrap them.',
    };
  }

  const parentNode = parentIds.length === 1
    ? tree.nodes.find((node) => node.id === parentIds[0])
    : null;
  if (parentNode && !isControlFlowNode(parentNode)) {
    return {
      ok: false,
      reason: 'Only children of a control-flow node can be wrapped into a subtree.',
    };
  }

  const siblingEdges = parentNode ? getChildEdges(tree, parentNode.id) : [];
  const selectedSiblingIndexes = siblingEdges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => selectedRoots.some((node) => node.id === edge.target))
    .map(({ index }) => index);

  const sortedIndexes = [...selectedSiblingIndexes].sort((a, b) => a - b);
  const isContiguous = sortedIndexes.every((index, offset) => {
    return offset === 0 || index === sortedIndexes[offset - 1] + 1;
  });

  if (parentNode && !isContiguous) {
    return {
      ok: false,
      reason: 'Wrap works on consecutive sequence items. Select neighboring children and try again.',
    };
  }

  const orderedSelectedRoots = parentNode
    ? siblingEdges
        .map((edge) => selectedRoots.find((node) => node.id === edge.target))
        .filter((node): node is BehaviorTreeNode => Boolean(node))
    : selectedRoots;
  const subtreeAnchor = averagePosition(orderedSelectedRoots);
  const toEmbeddedPosition = (position: XYPosition) => translatePosition(position, subtreeAnchor);
  const includedIds = collectDescendantIds(tree, orderedSelectedRoots.map((node) => node.id));
  const subtreeNodes = tree.nodes
    .filter((node) => includedIds.has(node.id))
    .map((node) => ({
      ...deepClone(node),
      position: toEmbeddedPosition(node.position),
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

  const shouldCreateWrapperRoot = selectedRoots.length > 1;
  const subtreeSequenceRootId = shouldCreateWrapperRoot
    ? getNextBehaviorNodeId(subtreeNodes as Array<Pick<Node, 'id'>>, 0)
    : null;
  const subtreeSequenceRoot: BehaviorTreeNode | null = subtreeSequenceRootId
    ? {
        id: subtreeSequenceRootId,
        type: BehaviorNodeType.Sequence,
        position: parentNode ? toEmbeddedPosition(parentNode.position) : { x: 0, y: 0 },
        data: {
          label: subtreeLabel,
          type: 'sequence',
          generatedBySubtreeWrap: true,
        },
      }
    : null;

  const subtreeEdgeSeed = internalEdges.length;
  const rootEdges: Edge[] = subtreeSequenceRoot
    ? orderedSelectedRoots.map((node, index) => ({
        id: `edge-subtree-${subtreeTreeId}-${subtreeEdgeSeed + index}`,
        source: subtreeSequenceRoot.id,
        target: node.id,
        sourceHandle: null,
        targetHandle: null,
        selected: false,
      }))
    : [];

  const embeddedTree: BehaviorTree = {
    id: subtreeTreeId,
    name: subtreeLabel,
    nodes: subtreeSequenceRoot ? [...subtreeNodes, subtreeSequenceRoot] : subtreeNodes,
    edges: [...rootEdges, ...internalEdges],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const subtreeNode = createSubtreeNode({
    id: subtreeNodeId,
    label: subtreeLabel,
    position: subtreeAnchor,
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
        parentNode &&
        edge.source === parentNode.id &&
        orderedSelectedRoots.some((node) => node.id === edge.target)
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
    selectedRootIds: orderedSelectedRoots.map((node) => node.id),
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
  const embeddedRoots = embeddedTree.nodes.filter((node) => !nodesWithIncoming.has(node.id));
  const generatedRoot =
    embeddedRoots.length === 1 && isGeneratedSubtreeRoot(embeddedRoots[0])
      ? embeddedRoots[0]
      : null;
  const generatedRootChildIds = generatedRoot
    ? new Set(
        embeddedTree.edges
          .filter((edge) => edge.source === generatedRoot.id)
          .map((edge) => edge.target)
      )
    : new Set<string>();
  const explodableNodes = generatedRoot
    ? embeddedTree.nodes.filter((node) => node.id !== generatedRoot.id)
    : embeddedTree.nodes;
  const explodableNodeIds = new Set(explodableNodes.map((node) => node.id));
  const explodableEdges = embeddedTree.edges.filter(
    (edge) =>
      explodableNodeIds.has(edge.source) &&
      explodableNodeIds.has(edge.target) &&
      edge.source !== generatedRoot?.id &&
      edge.target !== generatedRoot?.id
  );
  const explodableNodesWithIncoming = new Set(explodableEdges.map((edge) => edge.target));
  const explodableNodesWithOutgoing = new Set(explodableEdges.map((edge) => edge.source));
  const rootsToReconnect = generatedRoot
    ? explodableNodes.filter((node) => generatedRootChildIds.has(node.id))
    : explodableNodes.filter((node) => !explodableNodesWithIncoming.has(node.id));
  const leavesToReconnect = explodableNodes.filter(
    (node) => !explodableNodesWithOutgoing.has(node.id)
  );

  if (rootsToReconnect.length === 0) {
    return {
      ok: false,
      reason: 'This subtree has no root node to reconnect.',
    };
  }

  const anchor = averagePosition(rootsToReconnect);
  const allocationNodes: Array<Pick<Node, 'id'>> = tree.nodes.filter((node) => node.id !== subtreeNodeId);
  let nextNodeCounter = getNodeCounterAfterNodes(allocationNodes, startNodeIndex);
  const idMap = new Map<string, string>();

  const clonedNodes = explodableNodes.map((node) => {
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

  const internalEdges = explodableEdges.map((edge) => ({
    ...deepClone(edge),
    id: `edge-expand-${subtreeNode.id}-${crypto.randomUUID()}`,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
    selected: false,
  }));

  const makeReconnectedIncomingEdges = (edge: Edge): Edge[] =>
    rootsToReconnect.map((root) => ({
      ...deepClone(edge),
      id: `edge-expand-in-${subtreeNode.id}-${crypto.randomUUID()}`,
      target: idMap.get(root.id) ?? root.id,
      selected: false,
    }));
  const makeReconnectedOutgoingEdges = (edge: Edge): Edge[] =>
    leavesToReconnect.map((leaf) => ({
      ...deepClone(edge),
      id: `edge-expand-out-${subtreeNode.id}-${crypto.randomUUID()}`,
      source: idMap.get(leaf.id) ?? leaf.id,
      selected: false,
    }));

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
    ...tree.edges.flatMap((edge) => {
      if (edge.target === subtreeNode.id) {
        return makeReconnectedIncomingEdges(edge);
      }

      if (edge.source === subtreeNode.id) {
        return makeReconnectedOutgoingEdges(edge);
      }

      return [edge];
    }),
    ...internalEdges,
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
