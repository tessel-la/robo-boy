import { Edge, Node, XYPosition } from 'reactflow';

import {
  BehaviorNodeData,
  BehaviorNodeType,
  BehaviorTreeNode,
  ControlFlowNodeData,
  ROSActionInfo,
  ROSActionNodeData,
  ROSServiceInfo,
  ROSServiceNodeData,
  ROSTopicInfo,
  ROSTopicNodeData,
} from './types';

export type ROSNodeInfo = ROSActionInfo | ROSServiceInfo | ROSTopicInfo;

const NODE_ID_PREFIX = 'node-';
const EDGE_ID_PREFIX = 'edge-';
export const DUPLICATE_NODE_OFFSET: XYPosition = { x: 40, y: 40 };

const nodeIdPattern = /^node-(\d+)$/;
const edgeIdPattern = /^edge-(\d+)$/;

const deepClone = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export const getNextBehaviorNodeId = (
  nodes: Array<Pick<Node, 'id'>>,
  startIndex = 0
): string => {
  const usedIds = new Set(nodes.map((node) => node.id));
  let index = Math.max(0, startIndex);

  while (usedIds.has(`${NODE_ID_PREFIX}${index}`)) {
    index += 1;
  }

  return `${NODE_ID_PREFIX}${index}`;
};

export const getNodeCounterAfterNodes = (
  nodes: Array<Pick<Node, 'id'>>,
  startIndex = 0
): number => {
  return nodes.reduce((nextIndex, node) => {
    const match = node.id.match(nodeIdPattern);
    if (!match) return nextIndex;

    return Math.max(nextIndex, Number(match[1]) + 1);
  }, Math.max(0, startIndex));
};

export const createBehaviorNodeData = (
  nodeType: BehaviorNodeType,
  rosInfo?: ROSNodeInfo
): BehaviorNodeData | null => {
  switch (nodeType) {
    case BehaviorNodeType.Sequence:
      return { label: 'Sequence', type: 'sequence' } as ControlFlowNodeData;
    case BehaviorNodeType.Selector:
      return { label: 'Selector', type: 'selector' } as ControlFlowNodeData;
    case BehaviorNodeType.Parallel:
      return { label: 'Parallel', type: 'parallel' } as ControlFlowNodeData;
    case BehaviorNodeType.Retry:
      return {
        label: 'Retry',
        type: 'retry',
        description: 'Retry children on failure',
        iterationLimit: 3,
      } as ControlFlowNodeData;
    case BehaviorNodeType.Repeat:
      return {
        label: 'Repeat',
        type: 'repeat',
        description: 'Repeat children on success',
        iterationLimit: 3,
      } as ControlFlowNodeData;
    case BehaviorNodeType.Action:
      return {
        label: rosInfo?.name || 'Action',
        actionName: rosInfo?.name || '',
        actionType: rosInfo?.type || '',
      } as ROSActionNodeData;
    case BehaviorNodeType.Service:
      return {
        label: rosInfo?.name || 'Service',
        serviceName: rosInfo?.name || '',
        serviceType: rosInfo?.type || '',
      } as ROSServiceNodeData;
    case BehaviorNodeType.Topic:
      return {
        label: rosInfo?.name || 'Topic',
        topicName: rosInfo?.name || '',
        messageType: rosInfo?.type || '',
      } as ROSTopicNodeData;
    default:
      return null;
  }
};

export const createBehaviorTreeNode = ({
  id,
  nodeType,
  position,
  rosInfo,
}: {
  id: string;
  nodeType: BehaviorNodeType;
  position: XYPosition;
  rosInfo?: ROSNodeInfo;
}): BehaviorTreeNode | null => {
  const data = createBehaviorNodeData(nodeType, rosInfo);
  if (!data) return null;

  return {
    id,
    type: nodeType,
    position,
    data,
  };
};

const getNextEdgeId = (edges: Array<Pick<Edge, 'id'>>, startIndex: number): string => {
  const usedIds = new Set(edges.map((edge) => edge.id));
  let index = Math.max(0, startIndex);

  while (usedIds.has(`${EDGE_ID_PREFIX}${index}`)) {
    index += 1;
  }

  return `${EDGE_ID_PREFIX}${index}`;
};

const getEdgeCounterAfterEdges = (
  edges: Array<Pick<Edge, 'id'>>,
  startIndex = 0
): number => {
  return edges.reduce((nextIndex, edge) => {
    const match = edge.id.match(edgeIdPattern);
    if (!match) return nextIndex;

    return Math.max(nextIndex, Number(match[1]) + 1);
  }, Math.max(0, startIndex));
};

const cloneNodeDataWithoutStatus = (data: BehaviorNodeData): BehaviorNodeData => {
  const clonedData = deepClone(data);
  delete clonedData.status;
  return clonedData;
};

export interface DuplicateBehaviorNodesResult {
  nodes: BehaviorTreeNode[];
  edges: Edge[];
  duplicatedNodes: BehaviorTreeNode[];
  duplicatedEdges: Edge[];
  nextNodeCounter: number;
}

export const duplicateSelectedBehaviorNodes = ({
  nodes,
  edges,
  selectedNodeIds,
  startNodeIndex = 0,
  offset = DUPLICATE_NODE_OFFSET,
}: {
  nodes: BehaviorTreeNode[];
  edges: Edge[];
  selectedNodeIds: string[];
  startNodeIndex?: number;
  offset?: XYPosition;
}): DuplicateBehaviorNodesResult => {
  const selectedIds = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));

  if (selectedNodes.length === 0) {
    return {
      nodes,
      edges,
      duplicatedNodes: [],
      duplicatedEdges: [],
      nextNodeCounter: getNodeCounterAfterNodes(nodes, startNodeIndex),
    };
  }

  const idMap = new Map<string, string>();
  const allocationNodes: Array<Pick<Node, 'id'>> = [...nodes];
  let nextNodeCounter = getNodeCounterAfterNodes(nodes, startNodeIndex);

  selectedNodes.forEach((node) => {
    const nextId = getNextBehaviorNodeId(allocationNodes, nextNodeCounter);
    nextNodeCounter = getNodeCounterAfterNodes([{ id: nextId }], nextNodeCounter);
    allocationNodes.push({ id: nextId });
    idMap.set(node.id, nextId);
  });

  const duplicatedNodes = selectedNodes.map((node) => ({
    ...node,
    id: idMap.get(node.id) ?? node.id,
    position: {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y,
    },
    data: cloneNodeDataWithoutStatus(node.data),
    selected: true,
    dragging: false,
  }));

  const nextNodes = [
    ...nodes.map((node) =>
      selectedIds.has(node.id) ? { ...node, selected: false, dragging: false } : node
    ),
    ...duplicatedNodes,
  ];

  const edgeAllocation: Array<Pick<Edge, 'id'>> = [...edges];
  let nextEdgeCounter = getEdgeCounterAfterEdges(edges);
  const duplicatedEdges = edges
    .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
    .map((edge) => {
      const nextId = getNextEdgeId(edgeAllocation, nextEdgeCounter);
      nextEdgeCounter = getEdgeCounterAfterEdges([{ id: nextId }], nextEdgeCounter);
      edgeAllocation.push({ id: nextId });

      return {
        ...edge,
        id: nextId,
        source: idMap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? edge.target,
        selected: false,
      };
    });

  return {
    nodes: nextNodes,
    edges: [...edges, ...duplicatedEdges],
    duplicatedNodes,
    duplicatedEdges,
    nextNodeCounter,
  };
};
