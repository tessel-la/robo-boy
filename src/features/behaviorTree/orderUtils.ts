import { Edge } from 'reactflow';

import { BehaviorNodeType, BehaviorTreeNode } from './types';

const ORDERED_CONTROL_NODE_TYPES = new Set<string>([
  BehaviorNodeType.Sequence,
  BehaviorNodeType.Selector,
]);

export interface OrderedChildLink {
  edge: Edge;
  child: BehaviorTreeNode;
  index: number;
}

export const isOrderedControlNode = (node?: Pick<BehaviorTreeNode, 'type'> | null): boolean => {
  return Boolean(node?.type && ORDERED_CONTROL_NODE_TYPES.has(node.type));
};

export const getOrderedChildLinks = (
  parentId: string,
  nodes: BehaviorTreeNode[],
  edges: Edge[]
): OrderedChildLink[] => {
  return edges
    .filter((edge) => edge.source === parentId)
    .map((edge) => ({
      edge,
      child: nodes.find((node) => node.id === edge.target),
    }))
    .filter((item): item is { edge: Edge; child: BehaviorTreeNode } => Boolean(item.child))
    .map((item, index) => ({ ...item, index }));
};

export const moveOrderedChildEdge = (
  edges: Edge[],
  parentId: string,
  edgeId: string,
  direction: -1 | 1
): Edge[] => {
  const childEdges = edges.filter((edge) => edge.source === parentId);
  const currentIndex = childEdges.findIndex((edge) => edge.id === edgeId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= childEdges.length) {
    return edges;
  }

  const reorderedChildEdges = [...childEdges];
  const [movedEdge] = reorderedChildEdges.splice(currentIndex, 1);
  reorderedChildEdges.splice(nextIndex, 0, movedEdge);

  let replacementIndex = 0;
  return edges.map((edge) => {
    if (edge.source !== parentId) return edge;
    const replacement = reorderedChildEdges[replacementIndex];
    replacementIndex += 1;
    return replacement;
  });
};

export const annotateOrderedEdges = (
  nodes: BehaviorTreeNode[],
  edges: Edge[]
): Edge[] => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childEdgeIndexById = new Map<string, number>();

  nodes.filter(isOrderedControlNode).forEach((node) => {
    edges
      .filter((edge) => edge.source === node.id && nodeById.has(edge.target))
      .forEach((edge, index) => {
        childEdgeIndexById.set(edge.id, index + 1);
      });
  });

  return edges.map((edge) => {
    const order = childEdgeIndexById.get(edge.id);
    if (!order) return edge;

    return {
      ...edge,
      label: String(order),
      labelShowBg: true,
      labelBgPadding: [5, 4] as [number, number],
      labelBgBorderRadius: 999,
      labelStyle: {
        fill: 'var(--card-bg, #ffffff)',
        fontSize: 11,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: 'var(--primary-color, #4285f4)',
        stroke: 'var(--card-bg, #ffffff)',
        strokeWidth: 2,
      },
    };
  });
};
