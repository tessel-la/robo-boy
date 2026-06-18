import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  ReactFlowProvider,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import { FaArrowDown, FaArrowUp } from 'react-icons/fa';

import { nodeTypes } from './nodes/nodeTypes';
import NodePalette from './NodePalette';
import NodeSearch from './NodeSearch';
import BehaviorTreeToolbar from './BehaviorTreeToolbar';
import NodeNameEditor from './NodeNameEditor';
import ActionParameterEditor from './ActionParameterEditor';
import ServiceParameterEditor from './ServiceParameterEditor';
import { BehaviorTreeExecutor } from '../engine/executor';
import { arrangeBehaviorTree } from '../layoutUtils';
import {
  exportBehaviorTree,
  saveBehaviorTree,
  syncBehaviorTreeReferences,
} from '../storage/treeStorage';
import {
  createBehaviorTreeNode,
  duplicateSelectedBehaviorNodes,
  getNextBehaviorNodeId,
  getNodeCounterAfterNodes,
  ROSNodeInfo,
} from '../nodeUtils';
import {
  annotateOrderedEdges,
  getOrderedChildLinks,
  isOrderedControlNode,
  moveOrderedChildEdge,
  OrderedChildLink,
} from '../orderUtils';
import {
  BehaviorTree,
  BehaviorTreeNode,
  BehaviorNodeType,
  ROSActionNodeData,
  ROSServiceNodeData,
  ExecutionEvent,
  ExecutionStatus,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
} from '../types';
import {
  areTreePathsEqual,
  cloneBehaviorTree,
  createSubtreeNode,
  explodeSubtreeNode,
  getTreeAtPath,
  isSubtreeNode,
  resetBehaviorTreeExecutionState,
  replaceTreeAtPath,
  syncReferencedSubtrees,
  updateTreeAtPath,
  wrapSelectionIntoSubtree,
} from '../subtreeUtils';
import './BehaviorTreePanel.css';

interface BehaviorTreePanelProps {
  ros: Ros | null;
  isConnected: boolean;
  isActive: boolean;
  onExecutionChange?: (snapshot: BehaviorTreeExecutionSnapshot) => void;
  onExecutionControlsChange?: (controls: BehaviorTreeExecutionControls | null) => void;
}

export interface BehaviorTreeExecutionSnapshot {
  isExecuting: boolean;
  treeName: string;
  activeNodeId?: string;
  activeNodeLabel?: string;
  status?: ExecutionStatus | 'completed' | 'stopped' | 'error';
  startedAt?: number;
}

export interface BehaviorTreeExecutionControls {
  stop: () => void;
}

interface SaveNotice {
  id: number;
  type: 'success' | 'error';
  title: string;
  message: string;
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';

interface ChildOrderPanelProps {
  parent: BehaviorTreeNode;
  childLinks: OrderedChildLink[];
  onMoveChild: (edgeId: string, direction: -1 | 1) => void;
  onClose: () => void;
}

const getOrderNodeDetail = (node: BehaviorTreeNode): string | undefined => {
  const data = node.data;
  if ('actionName' in data) return data.actionName;
  if ('serviceName' in data) return data.serviceName;
  if ('topicName' in data) return data.topicName;
  return data.label;
};

const getDefaultNodeName = (node: BehaviorTreeNode): string => {
  const data = node.data;
  if ('actionName' in data && data.actionName) return data.actionName;
  if ('serviceName' in data && data.serviceName) return data.serviceName;
  if ('topicName' in data && data.topicName) return data.topicName;

  switch (node.type) {
    case BehaviorNodeType.Sequence:
      return 'Sequence';
    case BehaviorNodeType.Selector:
      return 'Selector';
    case BehaviorNodeType.Parallel:
      return 'Parallel';
    default:
      return data.label || 'Node';
  }
};

const getExecutionNodeKey = (nodeId: string, treePath: string[]): string =>
  `${treePath.join('/') || 'root'}::${nodeId}`;

const collectExecutionNodeLabels = (
  tree: BehaviorTree,
  treePath: string[] = [],
  labels: Map<string, string> = new Map()
): Map<string, string> => {
  tree.nodes.forEach((node) => {
    labels.set(getExecutionNodeKey(node.id, treePath), node.data.label || node.id);
    if (isSubtreeNode(node)) {
      collectExecutionNodeLabels(node.data.tree, [...treePath, node.id], labels);
    }
  });

  return labels;
};

const ChildOrderPanel: React.FC<ChildOrderPanelProps> = ({
  parent,
  childLinks,
  onMoveChild,
  onClose,
}) => (
  <div className="bt-order-panel" data-testid="bt-child-order-panel">
    <div className="bt-order-panel-header">
      <div className="bt-order-panel-title">
        <span className="bt-order-panel-kicker">{parent.data.label}</span>
        <span>Child order</span>
      </div>
      <div className="bt-order-panel-tools">
        <span className="bt-order-panel-count">{childLinks.length}</span>
        <button
          type="button"
          className="bt-order-close"
          onClick={onClose}
          aria-label="Close child order"
          title="Close"
        >
          ×
        </button>
      </div>
    </div>

    {childLinks.length === 0 ? (
      <div className="bt-order-empty">No children connected</div>
    ) : (
      <ol className="bt-order-list">
        {childLinks.map((link) => {
          const label = link.child.data.label || link.child.id;
          const detail = getOrderNodeDetail(link.child);
          return (
            <li className="bt-order-row" key={link.edge.id} data-testid="bt-order-row">
              <span className="bt-order-index">{link.index + 1}</span>
              <div className="bt-order-copy">
                <span className="bt-order-label" title={label}>{label}</span>
                {detail && detail !== label && (
                  <span className="bt-order-detail" title={detail}>{detail}</span>
                )}
              </div>
              <div className="bt-order-actions">
                <button
                  type="button"
                  className="bt-order-button"
                  onClick={() => onMoveChild(link.edge.id, -1)}
                  disabled={link.index === 0}
                  aria-label={`Move ${label} earlier`}
                  title="Move earlier"
                >
                  <FaArrowUp />
                </button>
                <button
                  type="button"
                  className="bt-order-button"
                  onClick={() => onMoveChild(link.edge.id, 1)}
                  disabled={link.index === childLinks.length - 1}
                  aria-label={`Move ${label} later`}
                  title="Move later"
                >
                  <FaArrowDown />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    )}
  </div>
);

const BehaviorTreePanelInner: React.FC<BehaviorTreePanelProps> = ({
  ros,
  isConnected,
  isActive,
  onExecutionChange,
  onExecutionControlsChange,
}) => {
  const [nodes, setNodes] = useState<BehaviorTreeNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [currentTree, setCurrentTree] = useState<BehaviorTree | null>(null);
  const [rootTree, setRootTree] = useState<BehaviorTree | null>(null);
  const [treePath, setTreePath] = useState<string[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(true);
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  // Action node currently being edited via the parameter editor modal.
  const [editingAction, setEditingAction] = useState<
    { nodeId: string; data: ROSActionNodeData } | null
  >(null);
  const [editingService, setEditingService] = useState<
    { nodeId: string; data: ROSServiceNodeData } | null
  >(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [orderingParentId, setOrderingParentId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [executionSnapshot, setExecutionSnapshot] = useState<BehaviorTreeExecutionSnapshot>({
    isExecuting: false,
    treeName: '',
  });
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const executorRef = useRef<BehaviorTreeExecutor | null>(null);
  const nodeIdCounter = useRef(0);
  const saveNoticeTimer = useRef<number | null>(null);
  const executionNodeLabels = useRef<Map<string, string>>(new Map());
  const executionStartedAt = useRef<number | undefined>(undefined);
  const lastMobileNodeTap = useRef<{ nodeId: string; timestamp: number } | null>(null);
  const currentTreeRef = useRef<BehaviorTree | null>(null);
  const rootTreeRef = useRef<BehaviorTree | null>(null);
  const treePathRef = useRef<string[]>([]);

  const { screenToFlowPosition, fitView, getZoom, setCenter } = useReactFlow();

  const allocateNodeId = useCallback((existingNodes: Node[]) => {
    const id = getNextBehaviorNodeId(existingNodes, nodeIdCounter.current);
    nodeIdCounter.current = getNodeCounterAfterNodes([{ id }], nodeIdCounter.current);
    return id;
  }, []);

  const resetTransientNodeState = useCallback((treeNodes: BehaviorTreeNode[]): BehaviorTreeNode[] => {
    return treeNodes.map((node) => ({
      ...node,
      selected: false,
      dragging: false,
      data: {
        ...node.data,
        isHighlighted: false,
      },
    }));
  }, []);

  const resetTransientEdgeState = useCallback((treeEdges: Edge[]): Edge[] => {
    return treeEdges.map((edge) => ({
      ...edge,
      selected: false,
      sourceHandle: null,
      targetHandle: null,
    }));
  }, []);

  useEffect(() => {
    currentTreeRef.current = currentTree;
  }, [currentTree]);

  useEffect(() => {
    rootTreeRef.current = rootTree;
  }, [rootTree]);

  useEffect(() => {
    treePathRef.current = treePath;
  }, [treePath]);

  const syncEditorState = useCallback(
    (tree: BehaviorTree, nextPath: string[]) => {
      const nextNodes = resetTransientNodeState(tree.nodes);
      const nextEdges = resetTransientEdgeState(tree.edges);
      const nextTree = {
        ...tree,
        nodes: nextNodes,
        edges: nextEdges,
      };

      currentTreeRef.current = nextTree;
      treePathRef.current = nextPath;
      setCurrentTree(nextTree);
      setTreePath(nextPath);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNodes([]);
      setOrderingParentId(null);
      setRenamingNodeId(null);
      setEditingAction(null);
      setEditingService(null);
      nodeIdCounter.current = getNodeCounterAfterNodes(nextNodes);
    },
    [resetTransientEdgeState, resetTransientNodeState]
  );

  const persistEditorTree = useCallback(
    (
      nextNodes: BehaviorTreeNode[],
      nextEdges: Edge[],
      treeOverrides: Partial<BehaviorTree> = {}
    ): BehaviorTree | null => {
      if (!currentTree) return null;

      const nextTree: BehaviorTree = {
        ...currentTree,
        ...treeOverrides,
        nodes: nextNodes,
        edges: nextEdges,
        updatedAt: Date.now(),
      };

      currentTreeRef.current = nextTree;
      setCurrentTree(nextTree);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setRootTree((previousRootTree) => {
        const nextRootTree =
          !previousRootTree || treePath.length === 0
            ? nextTree
            : updateTreeAtPath(previousRootTree, treePath, () => nextTree);
        rootTreeRef.current = nextRootTree;
        return nextRootTree;
      });
      return nextTree;
    },
    [currentTree, treePath]
  );

  const loadRootTree = useCallback(
    (tree: BehaviorTree) => {
      const hydrated: BehaviorTree = {
        ...tree,
        nodes: resetTransientNodeState(tree.nodes),
        edges: resetTransientEdgeState(tree.edges),
      };
      rootTreeRef.current = hydrated;
      setRootTree(hydrated);
      syncEditorState(hydrated, []);
    },
    [resetTransientEdgeState, resetTransientNodeState, syncEditorState]
  );

  const addNodeAtPosition = useCallback(
    (
      nodeType: BehaviorNodeType,
      position: { x: number; y: number },
      item?: ROSNodeInfo | BehaviorTree
    ) => {
      if (nodeType === BehaviorNodeType.Subtree && item && 'nodes' in item && 'edges' in item) {
        const subtreeNode = createSubtreeNode({
          id: allocateNodeId(nodes),
          label: item.name,
          position,
          tree: cloneBehaviorTree(item),
          sourceTreeId: item.id,
        });
        persistEditorTree([...nodes, subtreeNode], edges);
        return;
      }

      const newNode = createBehaviorTreeNode({
        id: allocateNodeId(nodes),
        nodeType,
        position,
        rosInfo: item as ROSNodeInfo | undefined,
      });
      if (!newNode) return;
      persistEditorTree([...nodes, newNode], edges);
    },
    [allocateNodeId, edges, nodes, persistEditorTree]
  );

  const showSaveNotice = useCallback((notice: Omit<SaveNotice, 'id'>) => {
    if (saveNoticeTimer.current !== null) {
      window.clearTimeout(saveNoticeTimer.current);
    }

    setSaveNotice({ ...notice, id: Date.now() });
    saveNoticeTimer.current = window.setTimeout(() => {
      setSaveNotice(null);
      saveNoticeTimer.current = null;
    }, 3200);
  }, []);

  const dismissSaveNotice = useCallback(() => {
    if (saveNoticeTimer.current !== null) {
      window.clearTimeout(saveNoticeTimer.current);
      saveNoticeTimer.current = null;
    }
    setSaveNotice(null);
  }, []);

  // Initialize with empty tree
  useEffect(() => {
    if (!rootTree) {
      const newTree: BehaviorTree = {
        id: uuidv4(),
        name: 'Untitled Behavior Tree',
        nodes: [],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      loadRootTree(newTree);
    }
  }, [loadRootTree, rootTree]);

  useEffect(() => {
    return () => {
      if (saveNoticeTimer.current !== null) {
        window.clearTimeout(saveNoticeTimer.current);
      }
    };
  }, []);

  // Strip sourceHandle so edges always bind to the node's default (null-id)
  // handle. This keeps saved trees compatible after the handle-ID refactor.
  const normalizeEdge = (e: Edge | Connection): Connection => ({
    ...e,
    sourceHandle: null,
    targetHandle: null,
  });

  const onConnect = useCallback(
    (connection: Connection) => {
      persistEditorTree(nodes, addEdge(normalizeEdge(connection), edges));
    },
    [edges, nodes, persistEditorTree]
  );

  const onNodesChange = useCallback(
    (changes: Parameters<typeof applyNodeChanges>[0]) => {
      persistEditorTree(applyNodeChanges(changes, nodes) as BehaviorTreeNode[], edges);
    },
    [edges, nodes, persistEditorTree]
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof applyEdgeChanges>[0]) => {
      persistEditorTree(nodes, applyEdgeChanges(changes, edges));
    },
    [edges, nodes, persistEditorTree]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const dataStr = event.dataTransfer.getData('application/reactflow');
      if (!dataStr) return;

      let data: { nodeType?: BehaviorNodeType; item?: ROSNodeInfo | BehaviorTree };
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }

      if (!data.nodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX - 75,
        y: event.clientY - 40,
      });

      addNodeAtPosition(data.nodeType, position, data.item);
    },
    [addNodeAtPosition, screenToFlowPosition]
  );

  const onNodesDelete = useCallback(
    (_deleted: Node[]) => {
      // React Flow handles cleanup internally; keep for logging if needed
    },
    []
  );

  // Track selected nodes for the delete button
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Node[] }) => {
      setSelectedNodes(sel);
    },
    []
  );

  // Delete selected nodes (and their connected edges)
  const handleDeleteSelected = useCallback(() => {
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    if (selectedIds.size === 0) return;

    persistEditorTree(
      nodes.filter((node) => !selectedIds.has(node.id)),
      edges.filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target))
    );
    setSelectedNodes([]);
  }, [edges, nodes, persistEditorTree, selectedNodes]);

  const handleDuplicateSelected = useCallback(() => {
    const selectedNodeIds = selectedNodes.map((node) => node.id);
    if (selectedNodeIds.length === 0) return;

    const result = duplicateSelectedBehaviorNodes({
      nodes: nodes as BehaviorTreeNode[],
      edges,
      selectedNodeIds,
      startNodeIndex: nodeIdCounter.current,
    });

    if (result.duplicatedNodes.length === 0) return;

    nodeIdCounter.current = result.nextNodeCounter;
    persistEditorTree(result.nodes, result.edges);
    setSelectedNodes(result.duplicatedNodes);
  }, [edges, nodes, persistEditorTree, selectedNodes]);

  const handleOpenSelectedNodeRename = useCallback(() => {
    if (selectedNodes.length !== 1) return;
    setRenamingNodeId(selectedNodes[0].id);
  }, [selectedNodes]);

  const handleSaveNodeName = useCallback(
    (name: string) => {
      if (!renamingNodeId) return;

      const nextNodes = nodes.map((node) =>
        node.id === renamingNodeId
          ? {
              ...node,
              data: isSubtreeNode(node)
                ? {
                    ...node.data,
                    label: name,
                    tree: {
                      ...node.data.tree,
                      name,
                    },
                  }
                : { ...node.data, label: name },
            }
          : node
      );

      persistEditorTree(nextNodes, edges);
      setSelectedNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === renamingNodeId
            ? {
                ...node,
                data:
                  'tree' in node.data
                    ? {
                        ...node.data,
                        label: name,
                        tree: {
                          ...node.data.tree,
                          name,
                        },
                      }
                    : { ...node.data, label: name },
              }
            : node
        )
      );
      setRenamingNodeId(null);
    },
    [edges, nodes, persistEditorTree, renamingNodeId]
  );

  const openSubtreeNode = useCallback((subtreeNodeId: string) => {
    if (!rootTree) return;
    const nextPath = [...treePath, subtreeNodeId];
    const nextTree = getTreeAtPath(rootTree, nextPath);
    if (!nextTree) return;

    syncEditorState(nextTree, nextPath);
  }, [rootTree, syncEditorState, treePath]);

  const handleOpenSelectedSubtree = useCallback(() => {
    if (selectedNodes.length !== 1) return;
    const selectedNode = nodes.find((node) => node.id === selectedNodes[0].id);
    if (!isSubtreeNode(selectedNode)) return;
    openSubtreeNode(selectedNode.id);
  }, [nodes, openSubtreeNode, selectedNodes]);

  const highlightClickedNode = useCallback(
    (clickedNodeId: string | null) => {
      persistEditorTree(
        nodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            isHighlighted: node.id === clickedNodeId,
          },
        })),
        edges
      );
    },
    [edges, nodes, persistEditorTree]
  );

  const openNodeEditor = useCallback((node: Node) => {
    if (node.type === BehaviorNodeType.Action) {
      setEditingAction({ nodeId: node.id, data: node.data as ROSActionNodeData });
    } else if (node.type === BehaviorNodeType.Service) {
      setEditingService({ nodeId: node.id, data: node.data as ROSServiceNodeData });
    } else if (isSubtreeNode(node as BehaviorTreeNode)) {
      openSubtreeNode(node.id);
    } else if (isOrderedControlNode(node as BehaviorTreeNode)) {
      setOrderingParentId(node.id);
    }
  }, [openSubtreeNode]);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      openNodeEditor(node);
    },
    [openNodeEditor]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      highlightClickedNode(node.id);

      if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
      if (
        node.type !== BehaviorNodeType.Action &&
        node.type !== BehaviorNodeType.Service &&
        node.type !== BehaviorNodeType.Subtree &&
        !isOrderedControlNode(node as BehaviorTreeNode)
      ) {
        return;
      }

      const now = Date.now();
      const previousTap = lastMobileNodeTap.current;
      lastMobileNodeTap.current = { nodeId: node.id, timestamp: now };

      if (previousTap?.nodeId === node.id && now - previousTap.timestamp < 420) {
        lastMobileNodeTap.current = null;
        openNodeEditor(node);
      }
    },
    [highlightClickedNode, openNodeEditor]
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const targetNode = nodes.find((node) => node.id === edge.target);
      if (!targetNode) return;

      const selectedTargetNode = { ...targetNode, selected: true, dragging: false };

      const nextNodes = nodes.map((node) => ({
          ...node,
          selected: node.id === edge.target,
          dragging: false,
          data: {
            ...node.data,
            isHighlighted: node.id === edge.target,
          },
        }));
      const nextEdges = edges.map((currentEdge) => ({
          ...currentEdge,
          selected: currentEdge.id === edge.id,
        }));
      persistEditorTree(nextNodes, nextEdges);
      setSelectedNodes([selectedTargetNode]);
      setOrderingParentId(null);
    },
    [edges, nodes, persistEditorTree]
  );

  const handleSaveActionParameters = useCallback(
    (parameters: Record<string, any>) => {
      if (!editingAction) return;
      const { nodeId } = editingAction;
      persistEditorTree(
        nodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, parameters } };
        }),
        edges
      );
    },
    [editingAction, edges, nodes, persistEditorTree]
  );

  const handleSaveServiceRequest = useCallback(
    (request: Record<string, any>) => {
      if (!editingService) return;
      const { nodeId } = editingService;
      persistEditorTree(
        nodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, request } };
        }),
        edges
      );
    },
    [editingService, edges, nodes, persistEditorTree]
  );

  const handleSave = useCallback(() => {
    if (!currentTree) return;
    const updatedTree: BehaviorTree = {
      ...currentTree,
      nodes: nodes as BehaviorTreeNode[],
      edges,
      updatedAt: Date.now(),
    };
    const success = saveBehaviorTree(updatedTree);
    if (success) {
      syncBehaviorTreeReferences(updatedTree);

      const activePath = treePathRef.current;
      const baseRootTree = rootTreeRef.current;
      const syncedRootTree = baseRootTree
        ? syncReferencedSubtrees(
            activePath.length === 0 ? updatedTree : updateTreeAtPath(baseRootTree, activePath, () => updatedTree),
            updatedTree
          )
        : updatedTree;

      rootTreeRef.current = syncedRootTree;
      setRootTree(syncedRootTree);

      const nextCurrentTree =
        activePath.length === 0 ? syncedRootTree : getTreeAtPath(syncedRootTree, activePath);
      if (nextCurrentTree) {
        syncEditorState(nextCurrentTree, activePath);
      } else {
        persistEditorTree(nodes, edges, { name: updatedTree.name });
      }

      showSaveNotice({
        type: 'success',
        title: 'Tree saved',
        message: `"${updatedTree.name}" is stored locally.`,
      });
    } else {
      showSaveNotice({
        type: 'error',
        title: 'Save failed',
        message: 'The tree could not be saved. Please try again.',
      });
    }
  }, [currentTree, edges, nodes, persistEditorTree, showSaveNotice, syncEditorState]);

  const handleLoad = useCallback((tree: BehaviorTree) => {
    if (treePath.length === 0) {
      loadRootTree(tree);
      return;
    }

    const loadedTree = { ...tree, name: tree.name || currentTree?.name || 'Subtree' };
    const nextRootTree = rootTree ? replaceTreeAtPath(rootTree, treePath, loadedTree) : loadedTree;
    const subtreeNodeId = treePath[treePath.length - 1];
    const parentPath = treePath.slice(0, -1);
    const parentTree =
      parentPath.length === 0 ? nextRootTree : getTreeAtPath(nextRootTree, parentPath);

    const nextRootWithLabel =
      subtreeNodeId && parentTree
        ? parentPath.length === 0
          ? {
              ...parentTree,
              nodes: parentTree.nodes.map((node) =>
                node.id === subtreeNodeId && isSubtreeNode(node)
                  ? { ...node, data: { ...node.data, label: loadedTree.name, tree: loadedTree } }
                  : node
              ),
            }
          : replaceTreeAtPath(nextRootTree, parentPath, {
              ...parentTree,
              nodes: parentTree.nodes.map((node) =>
                node.id === subtreeNodeId && isSubtreeNode(node)
                  ? { ...node, data: { ...node.data, label: loadedTree.name, tree: loadedTree } }
                  : node
              ),
            })
        : nextRootTree;

    setRootTree(nextRootWithLabel);
    syncEditorState(loadedTree, treePath);
  }, [currentTree?.name, loadRootTree, rootTree, syncEditorState, treePath]);

  const handleNew = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0) {
      if (!window.confirm('Create new tree? Unsaved changes will be lost.')) {
        return;
      }
    }
    const newTree: BehaviorTree = {
      id: uuidv4(),
      name: 'Untitled Behavior Tree',
      nodes: [],
      edges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (treePath.length === 0) {
      loadRootTree(newTree);
      return;
    }

    const nextRootTree = rootTree ? replaceTreeAtPath(rootTree, treePath, newTree) : newTree;
    const subtreeNodeId = treePath[treePath.length - 1];
    const parentPath = treePath.slice(0, -1);
    const parentTree =
      parentPath.length === 0 ? nextRootTree : getTreeAtPath(nextRootTree, parentPath);
    const nextRootWithLabel =
      subtreeNodeId && parentTree
        ? parentPath.length === 0
          ? {
              ...parentTree,
              nodes: parentTree.nodes.map((node) =>
                node.id === subtreeNodeId && isSubtreeNode(node)
                  ? { ...node, data: { ...node.data, label: newTree.name, tree: newTree } }
                  : node
              ),
            }
          : replaceTreeAtPath(nextRootTree, parentPath, {
              ...parentTree,
              nodes: parentTree.nodes.map((node) =>
                node.id === subtreeNodeId && isSubtreeNode(node)
                  ? { ...node, data: { ...node.data, label: newTree.name, tree: newTree } }
                  : node
              ),
            })
        : nextRootTree;

    setRootTree(nextRootWithLabel);
    syncEditorState(newTree, treePath);
  }, [edges.length, loadRootTree, nodes.length, rootTree, syncEditorState, treePath]);

  const handleExport = useCallback(() => {
    if (!currentTree) return;
    exportBehaviorTree({ ...currentTree, nodes: nodes as BehaviorTreeNode[], edges });
  }, [currentTree, nodes, edges]);

  const handleArrange = useCallback(() => {
    if (nodes.length === 0) return;

    persistEditorTree(arrangeBehaviorTree(nodes as BehaviorTreeNode[], edges), edges);
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 450, maxZoom: 1.15 });
    });
  }, [edges, fitView, nodes, persistEditorTree]);

  const handleRename = useCallback((name: string) => {
    if (!currentTree) return;

    const nextTree = { ...currentTree, name };
    currentTreeRef.current = nextTree;
    setCurrentTree(nextTree);
    setRootTree((previousRootTree) => {
      if (!previousRootTree || treePath.length === 0) {
        rootTreeRef.current = nextTree;
        return nextTree;
      }

      const renamedRootTree = replaceTreeAtPath(previousRootTree, treePath, nextTree);
      const subtreeNodeId = treePath[treePath.length - 1];
      const parentPath = treePath.slice(0, -1);
      if (!subtreeNodeId) return renamedRootTree;

      const parentTree = parentPath.length === 0 ? renamedRootTree : getTreeAtPath(renamedRootTree, parentPath);
      if (!parentTree) return renamedRootTree;

      const renamedParentTree: BehaviorTree = {
        ...parentTree,
        nodes: parentTree.nodes.map((node) =>
          node.id === subtreeNodeId && isSubtreeNode(node)
            ? {
                ...node,
                data: {
                  ...node.data,
                  label: name,
                  tree: nextTree,
                },
              }
            : node
        ),
      };

      const nextRootTree = parentPath.length === 0
        ? renamedParentTree
        : replaceTreeAtPath(renamedRootTree, parentPath, renamedParentTree);
      rootTreeRef.current = nextRootTree;
      return nextRootTree;
    });
  }, [currentTree, treePath]);

  const updateDisplayedNodeStatus = useCallback((nodeId: string, status: ExecutionStatus) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, status } } : node
      )
    );
    setCurrentTree((previousTree) => {
      if (!previousTree) return previousTree;

      const nextTree = {
        ...previousTree,
        nodes: previousTree.nodes.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, status } } : node
        ),
      };
      currentTreeRef.current = nextTree;
      return nextTree;
    });
  }, []);

  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      if (event.nodeId && event.data?.status) {
        const nodeId = event.nodeId;
        const status = event.data.status as ExecutionStatus;
        const eventPath = Array.isArray(event.data.treePath) ? event.data.treePath : [];

        setRootTree((previousRootTree) => {
          if (!previousRootTree) return previousRootTree;

          const nextRootTree = updateTreeAtPath(previousRootTree, eventPath, (targetTree) => ({
            ...targetTree,
            nodes: targetTree.nodes.map((node) =>
              node.id === nodeId ? { ...node, data: { ...node.data, status } } : node
            ),
          }));
          rootTreeRef.current = nextRootTree;
          return nextRootTree;
        });

        if (areTreePathsEqual(eventPath, treePathRef.current)) {
          updateDisplayedNodeStatus(nodeId, status);
        }

        if (status === ExecutionStatus.Running) {
          setExecutionSnapshot((prev) => ({
            ...prev,
            isExecuting: true,
            activeNodeId: nodeId,
            activeNodeLabel:
              executionNodeLabels.current.get(getExecutionNodeKey(nodeId, eventPath)) ?? nodeId,
            status,
          }));
        }
      }

      if (event.type === 'started') {
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: true,
          status: ExecutionStatus.Running,
          startedAt: executionStartedAt.current,
        }));
      } else if (event.type === 'completed' || event.type === 'stopped' || event.type === 'error') {
        const status = event.type;
        setIsExecuting(false);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: false,
          status,
        }));
        setTimeout(() => {
          setRootTree((previousRootTree) => {
            if (!previousRootTree) return previousRootTree;

            const nextRootTree = resetBehaviorTreeExecutionState(previousRootTree);
            rootTreeRef.current = nextRootTree;

            const activePath = treePathRef.current;
            const nextCurrentTree =
              activePath.length === 0 ? nextRootTree : getTreeAtPath(nextRootTree, activePath);

            if (nextCurrentTree) {
              const nextNodes = resetTransientNodeState(nextCurrentTree.nodes);
              const nextEdges = resetTransientEdgeState(nextCurrentTree.edges);
              const hydratedCurrentTree = {
                ...nextCurrentTree,
                nodes: nextNodes,
                edges: nextEdges,
              };
              currentTreeRef.current = hydratedCurrentTree;
              setCurrentTree(hydratedCurrentTree);
              setNodes(nextNodes);
              setEdges(nextEdges);
            }

            return nextRootTree;
          });
        }, 2000);
      }
    },
    [resetTransientEdgeState, resetTransientNodeState, updateDisplayedNodeStatus]
  );

  const handleExecute = useCallback(() => {
    if (!ros || !isConnected) {
      alert('Please connect to ROS first');
      return;
    }
    if (!currentTree || nodes.length === 0) {
      alert('Please create a behavior tree first');
      return;
    }
    const treeToExecute: BehaviorTree = {
      ...currentTree,
      nodes: nodes as BehaviorTreeNode[],
      edges,
    };
    executionNodeLabels.current = collectExecutionNodeLabels(treeToExecute);
    executionStartedAt.current = Date.now();
    executorRef.current = new BehaviorTreeExecutor(treeToExecute, ros, handleExecutionEvent);
    setIsExecuting(true);
    setExecutionSnapshot({
      isExecuting: true,
      treeName: treeToExecute.name,
      activeNodeLabel: 'Starting',
      status: ExecutionStatus.Running,
      startedAt: executionStartedAt.current,
    });
    executorRef.current.start();
  }, [ros, isConnected, currentTree, nodes, edges, handleExecutionEvent]);

  const handleStop = useCallback(() => {
    if (executorRef.current) executorRef.current.stop();
    setIsExecuting(false);
    setRootTree((previousRootTree) => {
      if (!previousRootTree) return previousRootTree;

      const nextRootTree = resetBehaviorTreeExecutionState(previousRootTree);
      rootTreeRef.current = nextRootTree;
      const activePath = treePathRef.current;
      const nextCurrentTree =
        activePath.length === 0 ? nextRootTree : getTreeAtPath(nextRootTree, activePath);

      if (nextCurrentTree) {
        const nextNodes = resetTransientNodeState(nextCurrentTree.nodes);
        const nextEdges = resetTransientEdgeState(nextCurrentTree.edges);
        const hydratedCurrentTree = {
          ...nextCurrentTree,
          nodes: nextNodes,
          edges: nextEdges,
        };
        currentTreeRef.current = hydratedCurrentTree;
        setCurrentTree(hydratedCurrentTree);
        setNodes(nextNodes);
        setEdges(nextEdges);
      }

      return nextRootTree;
    });
    setExecutionSnapshot((prev) => ({
      ...prev,
      isExecuting: false,
      status: 'stopped',
    }));
  }, [resetTransientEdgeState, resetTransientNodeState]);

  useEffect(() => {
    onExecutionChange?.(executionSnapshot);
  }, [executionSnapshot, onExecutionChange]);

  useEffect(() => {
    onExecutionControlsChange?.({ stop: handleStop });
    return () => onExecutionControlsChange?.(null);
  }, [handleStop, onExecutionControlsChange]);

  useEffect(() => {
    return () => {
      if (executorRef.current) executorRef.current.stop();
    };
  }, []);

  // Add a node at the centre of the visible canvas — used for mobile tap-to-add.
  const handleAddNode = useCallback(
    (
      nodeType: BehaviorNodeType,
      item?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo | BehaviorTree
    ) => {
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });

      addNodeAtPosition(nodeType, position, item);

      // Close palette on mobile after adding
      if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
        setIsPaletteCollapsed(true);
      }
    },
    [addNodeAtPosition, screenToFlowPosition]
  );

  const behaviorNodes = useMemo(() => nodes as BehaviorTreeNode[], [nodes]);
  const displayedEdges = useMemo(() => {
    const nodeStatusById = new Map(
      behaviorNodes.map((node) => [node.id, node.data.status ?? ExecutionStatus.Idle])
    );

    return annotateOrderedEdges(behaviorNodes, edges).map((edge) => {
      const targetStatus = nodeStatusById.get(edge.target) ?? ExecutionStatus.Idle;
      const isRunning = targetStatus === ExecutionStatus.Running;
      const isSuccess = targetStatus === ExecutionStatus.Success;
      const isFailure = targetStatus === ExecutionStatus.Failure;

      return {
        ...edge,
        animated: isRunning,
        style: {
          stroke: isRunning
            ? '#ffc107'
            : isSuccess
              ? '#4caf50'
              : isFailure
                ? '#f44336'
                : 'var(--primary-color, #4285f4)',
          strokeWidth: isRunning ? 4 : isSuccess || isFailure ? 3 : 2,
          opacity: isRunning || isSuccess || isFailure ? 1 : 0.9,
        },
      };
    });
  }, [behaviorNodes, edges]);
  const orderingParent = useMemo(() => {
    const parent = behaviorNodes.find((node) => node.id === orderingParentId);
    return isOrderedControlNode(parent) ? parent : null;
  }, [behaviorNodes, orderingParentId]);
  const renamingNode = useMemo(
    () => behaviorNodes.find((node) => node.id === renamingNodeId) ?? null,
    [behaviorNodes, renamingNodeId]
  );
  const selectedOrderedChildLinks = useMemo(
    () => (orderingParent ? getOrderedChildLinks(orderingParent.id, behaviorNodes, edges) : []),
    [behaviorNodes, edges, orderingParent]
  );
  const handleMoveOrderedChild = useCallback(
    (edgeId: string, direction: -1 | 1) => {
      if (!orderingParent) return;
      persistEditorTree(
        nodes,
        moveOrderedChildEdge(edges, orderingParent.id, edgeId, direction)
      );
    },
    [edges, nodes, orderingParent, persistEditorTree]
  );
  const handlePaneClick = useCallback(() => {
    setOrderingParentId(null);
  }, []);

  const selectedSubtreeNode = useMemo(() => {
    if (selectedNodes.length !== 1) return null;
    const node = behaviorNodes.find((candidate) => candidate.id === selectedNodes[0].id);
    return isSubtreeNode(node) ? node : null;
  }, [behaviorNodes, selectedNodes]);

  const canWrapSelection = useMemo(() => {
    if (!currentTree || selectedNodes.length < 2) return false;

    return wrapSelectionIntoSubtree({
      tree: { ...currentTree, nodes: behaviorNodes, edges },
      selectedNodeIds: selectedNodes.map((node) => node.id),
      subtreeNodeId: 'preview-subtree',
      subtreeTreeId: 'preview-tree',
      subtreeLabel: 'Subtree',
    }).ok;
  }, [behaviorNodes, currentTree, edges, selectedNodes]);

  const handleWrapSelectedIntoSubtree = useCallback(() => {
    if (!currentTree) return;

    const result = wrapSelectionIntoSubtree({
      tree: { ...currentTree, nodes: behaviorNodes, edges },
      selectedNodeIds: selectedNodes.map((node) => node.id),
      subtreeNodeId: allocateNodeId(behaviorNodes),
      subtreeTreeId: uuidv4(),
      subtreeLabel: 'Subtree',
    });

    if (!result.ok) {
      showSaveNotice({
        type: 'error',
        title: 'Wrap failed',
        message: result.reason,
      });
      return;
    }

    const nextNodes = (result.tree.nodes as BehaviorTreeNode[]).map((node) => ({
      ...node,
      selected: node.id === result.subtreeNode.id,
      data: {
        ...node.data,
        isHighlighted: node.id === result.subtreeNode.id,
      },
    }));

    persistEditorTree(nextNodes, result.tree.edges, {
      updatedAt: result.tree.updatedAt,
    });
    setSelectedNodes([
      {
        ...result.subtreeNode,
        selected: true,
        data: {
          ...result.subtreeNode.data,
          isHighlighted: true,
        },
      },
    ]);
    setOrderingParentId(null);
  }, [
    allocateNodeId,
    behaviorNodes,
    currentTree,
    edges,
    persistEditorTree,
    selectedNodes,
    showSaveNotice,
  ]);

  const handleSaveSelectedSubtree = useCallback(() => {
    if (!selectedSubtreeNode) return;

    const subtreeTree = cloneBehaviorTree(selectedSubtreeNode.data.tree);
    const savedTree: BehaviorTree = {
      ...subtreeTree,
      name: selectedSubtreeNode.data.label,
      updatedAt: Date.now(),
    };
    const success = saveBehaviorTree(savedTree);

    if (success) {
      syncBehaviorTreeReferences(savedTree);
      if (rootTreeRef.current) {
        const syncedRootTree = syncReferencedSubtrees(rootTreeRef.current, savedTree);
        rootTreeRef.current = syncedRootTree;
        setRootTree(syncedRootTree);

        const activePath = treePathRef.current;
        const nextCurrentTree =
          activePath.length === 0 ? syncedRootTree : getTreeAtPath(syncedRootTree, activePath);
        if (nextCurrentTree) {
          syncEditorState(nextCurrentTree, activePath);
        }
      }
    }

    showSaveNotice(
      success
        ? {
            type: 'success',
            title: 'Subtree saved',
            message: `"${selectedSubtreeNode.data.label}" is ready to drag back into a tree.`,
          }
        : {
            type: 'error',
            title: 'Save failed',
            message: 'The selected subtree could not be saved.',
          }
    );
  }, [selectedSubtreeNode, showSaveNotice, syncEditorState]);

  const handleExplodeSelectedSubtree = useCallback(() => {
    if (!currentTree || !selectedSubtreeNode) return;

    const result = explodeSubtreeNode({
      tree: { ...currentTree, nodes: behaviorNodes, edges },
      subtreeNodeId: selectedSubtreeNode.id,
      startNodeIndex: nodeIdCounter.current,
    });

    if (!result.ok) {
      showSaveNotice({
        type: 'error',
        title: 'Explode failed',
        message: result.reason,
      });
      return;
    }

    nodeIdCounter.current = result.nextNodeCounter;
    persistEditorTree(result.tree.nodes as BehaviorTreeNode[], result.tree.edges, {
      updatedAt: result.tree.updatedAt,
    });
    setSelectedNodes(
      result.tree.nodes
        .filter((node) => result.insertedNodeIds.includes(node.id))
        .map((node) => ({
          ...node,
          selected: true,
          dragging: false,
        }))
    );
    setOrderingParentId(null);
  }, [
    behaviorNodes,
    currentTree,
    edges,
    persistEditorTree,
    selectedSubtreeNode,
    showSaveNotice,
  ]);

  const handleNavigateUp = useCallback(() => {
    if (!rootTree || treePath.length === 0) return;
    const nextPath = treePath.slice(0, -1);
    const nextTree = nextPath.length === 0 ? rootTree : getTreeAtPath(rootTree, nextPath);
    if (!nextTree) return;
    syncEditorState(nextTree, nextPath);
  }, [rootTree, syncEditorState, treePath]);

  const handleSearchSelect = useCallback(
    (node: BehaviorTreeNode) => {
      const position = node.positionAbsolute ?? node.position;
      const centerX = position.x + (node.width ?? 150) / 2;
      const centerY = position.y + (node.height ?? 80) / 2;
      const selectedNode = { ...node, selected: true, dragging: false };

      persistEditorTree(
        nodes.map((currentNode) => ({
          ...currentNode,
          selected: currentNode.id === node.id,
          dragging: false,
          data: {
            ...currentNode.data,
            isHighlighted: currentNode.id === node.id,
          },
        })),
        edges
      );
      setSelectedNodes([selectedNode]);
      setOrderingParentId(null);
      setCenter(centerX, centerY, { zoom: Math.max(getZoom(), 1), duration: 400 });
    },
    [edges, getZoom, nodes, persistEditorTree, setCenter]
  );

  return (
    <div className="behavior-tree-panel" data-testid="behavior-tree-panel">
      <BehaviorTreeToolbar
        currentTree={currentTree}
        isExecuting={isExecuting}
        isPaletteCollapsed={isPaletteCollapsed}
        isEditingSubtree={treePath.length > 0}
        nodeCount={nodes.length}
        selectedNodeCount={selectedNodes.length}
        canWrapSelection={canWrapSelection}
        hasSelectedSubtree={Boolean(selectedSubtreeNode)}
        onSave={handleSave}
        onLoad={handleLoad}
        onNew={handleNew}
        onExecute={handleExecute}
        onStop={handleStop}
        onExport={handleExport}
        onArrange={handleArrange}
        onTogglePalette={() => setIsPaletteCollapsed((collapsed) => !collapsed)}
        onDeleteSelected={handleDeleteSelected}
        onDuplicateSelected={handleDuplicateSelected}
        onRenameSelected={handleOpenSelectedNodeRename}
        onWrapSelection={handleWrapSelectedIntoSubtree}
        onOpenSelectedSubtree={handleOpenSelectedSubtree}
        onSaveSelectedSubtree={handleSaveSelectedSubtree}
        onExplodeSelectedSubtree={handleExplodeSelectedSubtree}
        onNavigateUp={handleNavigateUp}
        onRename={handleRename}
      />

      {saveNotice && (
        <div
          key={saveNotice.id}
          className={`bt-save-toast ${saveNotice.type}`}
          role={saveNotice.type === 'error' ? 'alert' : 'status'}
          aria-live={saveNotice.type === 'error' ? 'assertive' : 'polite'}
        >
          <div className="bt-save-toast-icon" aria-hidden="true">
            {saveNotice.type === 'success' ? (
              <svg width="15" height="12" viewBox="0 0 15 12" fill="none">
                <path
                  d="M1 6.4l3.8 3.8L14 1"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M1.5 1.5l10 10M11.5 1.5l-10 10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
          <div className="bt-save-toast-copy">
            <div className="bt-save-toast-title">{saveNotice.title}</div>
            <div className="bt-save-toast-message">{saveNotice.message}</div>
          </div>
          <button
            className="bt-save-toast-close"
            onClick={dismissSaveNotice}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      <div className="bt-content">
        <NodePalette
          ros={ros}
          isConnected={isConnected}
          isCollapsed={isPaletteCollapsed}
          onToggleCollapse={() => setIsPaletteCollapsed((collapsed) => !collapsed)}
          onAddNode={handleAddNode}
        />

        <div className="bt-canvas" ref={reactFlowWrapper} data-testid="bt-canvas">
          <ReactFlow
            nodes={nodes}
            edges={displayedEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodesDelete={onNodesDelete}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeClick={onEdgeClick}
            onPaneClick={handlePaneClick}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={48}
            fitView
            minZoom={0.1}
            maxZoom={2}
            deleteKeyCode={['Backspace', 'Delete']}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: 'var(--primary-color, #4285f4)', strokeWidth: 2 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeStrokeWidth={3}
              zoomable
              pannable
              style={{
                background: 'var(--card-bg, #ffffff)',
                border: '1px solid var(--border-color, #e0e0e0)',
              }}
            />
          </ReactFlow>
          <NodeSearch nodes={behaviorNodes} onSelectNode={handleSearchSelect} />
          {orderingParent && (
            <ChildOrderPanel
              parent={orderingParent}
              childLinks={selectedOrderedChildLinks}
              onMoveChild={handleMoveOrderedChild}
              onClose={() => setOrderingParentId(null)}
            />
          )}
        </div>
      </div>

      {editingAction && (
        <ActionParameterEditor
          nodeData={editingAction.data}
          ros={ros}
          onSave={handleSaveActionParameters}
          onClose={() => setEditingAction(null)}
        />
      )}
      {editingService && (
        <ServiceParameterEditor
          nodeData={editingService.data}
          ros={ros}
          onSave={handleSaveServiceRequest}
          onClose={() => setEditingService(null)}
        />
      )}
      {renamingNode && (
        <NodeNameEditor
          initialName={renamingNode.data.label}
          defaultName={getDefaultNodeName(renamingNode)}
          onSave={handleSaveNodeName}
          onClose={() => setRenamingNodeId(null)}
        />
      )}
    </div>
  );
};

const BehaviorTreePanel: React.FC<BehaviorTreePanelProps> = (props) => (
  <ReactFlowProvider>
    <BehaviorTreePanelInner {...props} />
  </ReactFlowProvider>
);

export default BehaviorTreePanel;
