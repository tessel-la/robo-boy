import { Edge } from 'reactflow';

import { BehaviorTreeNode } from './types';

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 96;
const HORIZONTAL_GAP = 64;
const VERTICAL_GAP = 88;

const getNodeWidth = (node: BehaviorTreeNode): number => node.width ?? DEFAULT_NODE_WIDTH;

const getNodeHeight = (node: BehaviorTreeNode): number => node.height ?? DEFAULT_NODE_HEIGHT;

/**
 * Arranges behavior nodes as a top-down forest while preserving outgoing edge order.
 * Disconnected nodes become additional roots and malformed cycles are laid out once.
 */
export const arrangeBehaviorTree = (nodes: BehaviorTreeNode[], edges: Edge[]): BehaviorTreeNode[] => {
  if (nodes.length === 0) return nodes;

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const incomingCount = new Map(nodes.map(node => [node.id, 0]));
  const childrenById = new Map(nodes.map(node => [node.id, [] as string[]]));

  edges.forEach(edge => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return;

    childrenById.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  });

  const roots = nodes.filter(node => (incomingCount.get(node.id) ?? 0) === 0).map(node => node.id);
  const traversalStarts = [...roots, ...nodes.map(node => node.id)];
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const levelHeight = Math.max(DEFAULT_NODE_HEIGHT, ...nodes.map(getNodeHeight));
  let nextLeafX = 0;

  const layoutSubtree = (nodeId: string, depth: number, ancestors: Set<string>): number => {
    const node = nodeById.get(nodeId);
    if (!node) return nextLeafX;

    visited.add(nodeId);
    const nextAncestors = new Set(ancestors).add(nodeId);
    const childIds = Array.from(new Set(childrenById.get(nodeId) ?? [])).filter(
      childId => !visited.has(childId) && !nextAncestors.has(childId)
    );

    let centerX: number;
    if (childIds.length === 0) {
      centerX = nextLeafX + getNodeWidth(node) / 2;
      nextLeafX += getNodeWidth(node) + HORIZONTAL_GAP;
    } else {
      const childCenters = childIds.map(childId => layoutSubtree(childId, depth + 1, nextAncestors));
      centerX = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    }

    positions.set(nodeId, {
      x: centerX - getNodeWidth(node) / 2,
      y: depth * (levelHeight + VERTICAL_GAP),
    });
    return centerX;
  };

  traversalStarts.forEach(nodeId => {
    if (visited.has(nodeId)) return;
    layoutSubtree(nodeId, 0, new Set());
  });

  return nodes.map(node => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
    positionAbsolute: undefined,
    dragging: false,
  }));
};
