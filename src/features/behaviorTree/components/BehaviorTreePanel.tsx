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
  SelectionMode,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import {
  FaArrowDown,
  FaArrowUp,
  FaClone,
  FaCog,
  FaEdit,
  FaExpandArrowsAlt,
  FaFolderOpen,
  FaLevelUpAlt,
  FaObjectGroup,
  FaSave,
  FaTrash,
} from 'react-icons/fa';

import { nodeTypes } from './nodes/nodeTypes';
import NodePalette from './NodePalette';
import NodeSearch from './NodeSearch';
import BehaviorTreeToolbar from './BehaviorTreeToolbar';
import type { BehaviorTreeInteractionMode } from './BehaviorTreeToolbar';
import NodeNameEditor from './NodeNameEditor';
import ActionParameterEditor from './ActionParameterEditor';
import ServiceParameterEditor from './ServiceParameterEditor';
import BehaviorNodeConfigEditor from './BehaviorNodeConfigEditor';
import BehaviorTreeAgentPanel from './BehaviorTreeAgentPanel';
import { buildTreeDiff, summarizeTreeChanges } from './BehaviorTreeAgentPreview';
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
  ControlFlowNodeData,
  ROSActionNodeData,
  ROSServiceNodeData,
  ExecutionEvent,
  ExecutionStatus,
  ROSActionInfo,
  ROSServiceInfo,
  ROSTopicInfo,
  BlackboardInputBinding,
  BlackboardOutputBinding,
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
  isPaused?: boolean;
  treeName: string;
  activeNodeId?: string;
  activeNodeLabel?: string;
  status?: ExecutionStatus | 'paused' | 'completed' | 'stopped' | 'error';
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

interface SyncEditorOptions {
  center?: boolean;
}

interface HistorySnapshot {
  tree: BehaviorTree;
  activeTree: BehaviorTree | null;
  path: string[];
}

interface CustomBoxSelectionGesture {
  pointerId: number;
  element: HTMLDivElement;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  didDrag: boolean;
}

interface CustomBoxSelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ManualEdgeSelection {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  expiresAt: number;
}

interface SelectionActionAnchor {
  x: number;
  y: number;
  placement: 'inline' | 'above' | 'below';
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';
const MAX_UNDO_HISTORY = 80;
const SELECTION_ACTIONS_MAX_WIDTH = 360;
const SELECTION_ACTIONS_MOBILE_MARGIN = 10;
const SELECTION_ACTIONS_MOBILE_GAP = 14;
const SELECTION_ACTIONS_MOBILE_ESTIMATED_HEIGHT = 110;
const BOX_SELECTION_CLEAR_SUPPRESSION_MS = 120;
const BOX_SELECTION_DRAG_THRESHOLD = 4;
const PALETTE_ADD_NODE_X_GAP = 190;
const PALETTE_ADD_NODE_Y_GAP = 130;
const PALETTE_ADD_NODE_COLUMNS = 3;
const NODE_POSITION_COLLISION_X = 160;
const NODE_POSITION_COLLISION_Y = 110;
const MANUAL_EDGE_SELECTION_SUPPRESSION_MS = 160;
const AGENT_PREVIEW_ID_PREFIX = 'agent-preview:';

const getReactFlowChangeElementId = (change: unknown): string | null => {
  if (!change || typeof change !== 'object') return null;
  const candidate = change as { id?: unknown; item?: { id?: unknown } };
  if (typeof candidate.id === 'string') return candidate.id;
  return typeof candidate.item?.id === 'string' ? candidate.item.id : null;
};

const isAgentPreviewChange = (change: unknown) =>
  getReactFlowChangeElementId(change)?.startsWith(AGENT_PREVIEW_ID_PREFIX) ?? false;

const getKnownReactFlowElementId = (
  element: Element,
  knownIds: Set<string>,
  testIdPrefixes: string[]
): string | null => {
  const dataId = element.getAttribute('data-id');
  if (dataId && knownIds.has(dataId)) return dataId;

  const testId = element.getAttribute('data-testid');
  if (!testId) return null;

  for (const prefix of testIdPrefixes) {
    if (testId.startsWith(prefix)) {
      const id = testId.slice(prefix.length);
      if (knownIds.has(id)) return id;
    }
  }

  return null;
};

const rectsIntersect = (first: DOMRect, second: DOMRect) =>
  first.right >= second.left - 1 &&
  first.left <= second.right + 1 &&
  first.bottom >= second.top - 1 &&
  first.top <= second.bottom + 1;

const rectFullyContains = (outer: DOMRect, inner: DOMRect) =>
  inner.left >= outer.left - 1 &&
  inner.right <= outer.right + 1 &&
  inner.top >= outer.top - 1 &&
  inner.bottom <= outer.bottom + 1;

const createViewportRect = (left: number, top: number, right: number, bottom: number): DOMRect => ({
  x: left,
  y: top,
  width: right - left,
  height: bottom - top,
  left,
  top,
  right,
  bottom,
  toJSON: () => ({}),
} as DOMRect);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const findOpenPaletteAddPosition = (
  position: { x: number; y: number },
  existingNodes: BehaviorTreeNode[]
): { x: number; y: number } => {
  const isOccupied = (candidate: { x: number; y: number }) =>
    existingNodes.some(
      (node) =>
        Math.abs(node.position.x - candidate.x) < NODE_POSITION_COLLISION_X &&
        Math.abs(node.position.y - candidate.y) < NODE_POSITION_COLLISION_Y
    );

  for (let index = 0; index < 12; index += 1) {
    const candidate = {
      x: position.x + (index % PALETTE_ADD_NODE_COLUMNS) * PALETTE_ADD_NODE_X_GAP,
      y: position.y + Math.floor(index / PALETTE_ADD_NODE_COLUMNS) * PALETTE_ADD_NODE_Y_GAP,
    };

    if (!isOccupied(candidate)) return candidate;
  }

  return {
    x: position.x + existingNodes.length * 48,
    y: position.y + existingNodes.length * 48,
  };
};

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
    case BehaviorNodeType.Retry:
      return 'Retry';
    case BehaviorNodeType.Repeat:
      return 'Repeat';
    default:
      return data.label || 'Node';
  }
};

const isIteratingControlNode = (node?: BehaviorTreeNode | Node | null): node is BehaviorTreeNode =>
  node?.type === BehaviorNodeType.Retry || node?.type === BehaviorNodeType.Repeat;

const normalizeIterationLimit = (value: number): number => {
  if (value === -1) return -1;
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.trunc(value));
};

const getIterationLimit = (node: BehaviorTreeNode): number =>
  normalizeIterationLimit((node.data as ControlFlowNodeData).iterationLimit ?? 3);

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

interface IterationLimitEditorProps {
  node: BehaviorTreeNode;
  onSave: (limit: number) => void;
  onClose: () => void;
}

const IterationLimitEditor: React.FC<IterationLimitEditorProps> = ({ node, onSave, onClose }) => {
  const [value, setValue] = useState(String(getIterationLimit(node)));
  const parsed = Number(value);
  const isValid =
    value.trim() !== '' && Number.isFinite(parsed) && (parsed === -1 || Math.trunc(parsed) >= 1);
  const nodeKind = node.type === BehaviorNodeType.Retry ? 'Retry' : 'Repeat';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    onSave(normalizeIterationLimit(parsed));
  };

  return (
    <div className="bt-iteration-overlay" role="dialog" aria-modal="true">
      <form className="bt-iteration-dialog" onSubmit={handleSubmit}>
        <div className="bt-node-name-header">
          <div>
            <div className="bt-node-name-kicker">{node.data.label}</div>
            <h2>{nodeKind} count</h2>
          </div>
          <button
            type="button"
            className="bt-node-name-close"
            onClick={onClose}
            aria-label="Close count editor"
          >
            ×
          </button>
        </div>

        <label className="bt-node-name-label" htmlFor="bt-iteration-limit">
          {node.type === BehaviorNodeType.Retry ? 'Attempts' : 'Repeats'}
        </label>
        <input
          id="bt-iteration-limit"
          className="bt-node-name-input"
          type="number"
          step="1"
          min="-1"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
        />
        <div className="bt-iteration-help">Use -1 for infinite.</div>

        <div className="bt-node-name-actions">
          <button type="button" className="bt-node-name-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="bt-node-name-save" disabled={!isValid}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
};

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
  const [isPaused, setIsPaused] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(true);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentPreviewTree, setAgentPreviewTree] = useState<BehaviorTree | null>(null);
  const [agentPreviewDimensions, setAgentPreviewDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<Edge[]>([]);
  const [selectionActionAnchor, setSelectionActionAnchor] = useState<SelectionActionAnchor | null>(null);
  const [customBoxSelection, setCustomBoxSelection] = useState<CustomBoxSelectionBox | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [canvasInteractionMode, setCanvasInteractionMode] =
    useState<BehaviorTreeInteractionMode>('pan');
  const [isFollowMode, setIsFollowMode] = useState(false);
  // Action node currently being edited via the parameter editor modal.
  const [editingAction, setEditingAction] = useState<
    { nodeId: string; data: ROSActionNodeData } | null
  >(null);
  const [editingService, setEditingService] = useState<
    { nodeId: string; data: ROSServiceNodeData } | null
  >(null);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [editingIterationNodeId, setEditingIterationNodeId] = useState<string | null>(null);
  const [editingConfigNodeId, setEditingConfigNodeId] = useState<string | null>(null);
  const [liveBlackboard, setLiveBlackboard] = useState<Record<string, unknown>>({});
  const [orderingParentId, setOrderingParentId] = useState<string | null>(null);
  const [subtreeReturnAnchor, setSubtreeReturnAnchor] = useState<{ x: number; y: number } | null>(null);
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
  const undoHistoryRef = useRef<HistorySnapshot[]>([]);
  const redoHistoryRef = useRef<HistorySnapshot[]>([]);
  const isRestoringHistory = useRef(false);
  const selectedNodeIdsRef = useRef<Set<string>>(new Set());
  const selectedEdgeIdsRef = useRef<Set<string>>(new Set());
  const boxSelectionActiveRef = useRef(false);
  const boxSelectionNodeIdsRef = useRef<Set<string> | null>(null);
  const boxSelectionEdgeIdsRef = useRef<Set<string> | null>(null);
  const boxSelectionEndedAtRef = useRef(0);
  const boxSelectionPointerDownRef = useRef(false);
  const boxSelectionEndPendingRef = useRef(false);
  const customBoxSelectionGestureRef = useRef<CustomBoxSelectionGesture | null>(null);
  const customBoxSelectionRectRef = useRef<DOMRect | null>(null);
  const subtreeReturnAnchorFrameRef = useRef<number | null>(null);
  const manualEdgeSelectionRef = useRef<ManualEdgeSelection | null>(null);
  const nodeMultiSelectSnapshotRef = useRef<Set<string> | null>(null);
  const isFollowModeRef = useRef(false);
  const followExecutionFrameRef = useRef<number | null>(null);
  const agentPreviewFitTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    isFollowModeRef.current = isFollowMode;
  }, [isFollowMode]);

  const centerTreeInView = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        fitView({ padding: 0.22, duration: 380, maxZoom: 1.1 });
      });
    });
  }, [fitView]);

  const fitAgentPreviewInView = useCallback(() => {
    if (agentPreviewFitTimerRef.current !== null) {
      window.clearTimeout(agentPreviewFitTimerRef.current);
    }

    let attempts = 0;
    const tryFit = () => {
      agentPreviewFitTimerRef.current = null;
      const fitted = fitView({ padding: 0.2, duration: 420, maxZoom: 1.15 });
      if (fitted || attempts >= 10) return;
      attempts += 1;
      agentPreviewFitTimerRef.current = window.setTimeout(tryFit, 50);
    };

    window.requestAnimationFrame(tryFit);
  }, [fitView]);

  useEffect(() => () => {
    if (agentPreviewFitTimerRef.current !== null) {
      window.clearTimeout(agentPreviewFitTimerRef.current);
    }
  }, []);

  const syncEditorState = useCallback(
    (tree: BehaviorTree, nextPath: string[], options: SyncEditorOptions = {}) => {
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
      setSelectedEdges([]);
      selectedNodeIdsRef.current = new Set();
      selectedEdgeIdsRef.current = new Set();
      setOrderingParentId(null);
      setRenamingNodeId(null);
      setEditingIterationNodeId(null);
      setEditingAction(null);
      setEditingService(null);
      nodeIdCounter.current = getNodeCounterAfterNodes(nextNodes);
      if (options.center && nextNodes.length > 0) {
        centerTreeInView();
      }
    },
    [centerTreeInView, resetTransientEdgeState, resetTransientNodeState]
  );

  const syncRootTreeAndEditor = useCallback(
    (nextRootTree: BehaviorTree, preferredPath: string[], options: SyncEditorOptions = {}) => {
      const nextTreeAtPath =
        preferredPath.length === 0 ? nextRootTree : getTreeAtPath(nextRootTree, preferredPath);
      const nextPath = nextTreeAtPath ? preferredPath : [];
      const nextTree = nextTreeAtPath ?? nextRootTree;

      rootTreeRef.current = nextRootTree;
      setRootTree(nextRootTree);
      syncEditorState(nextTree, nextPath, options);
    },
    [syncEditorState]
  );

  const createHistorySnapshot = useCallback((): HistorySnapshot | null => {
    if (!rootTreeRef.current) return null;

    return {
      tree: cloneBehaviorTree(rootTreeRef.current),
      activeTree: currentTreeRef.current ? cloneBehaviorTree(currentTreeRef.current) : null,
      path: [...treePathRef.current],
    };
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    if (isRestoringHistory.current || !rootTreeRef.current) return;
    const snapshot = createHistorySnapshot();
    if (!snapshot) return;

    undoHistoryRef.current = [
      ...undoHistoryRef.current.slice(-(MAX_UNDO_HISTORY - 1)),
      snapshot,
    ];
    redoHistoryRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [createHistorySnapshot]);

  const persistEditorTree = useCallback(
    (
      nextNodes: BehaviorTreeNode[],
      nextEdges: Edge[],
      treeOverrides: Partial<BehaviorTree> = {}
    ): BehaviorTree | null => {
      const activeTree = currentTreeRef.current;
      const activePath = treePathRef.current;
      if (!activeTree) return null;
      pushUndoSnapshot();

      const nextTree: BehaviorTree = {
        ...activeTree,
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
        const baseRootTree = previousRootTree ?? rootTreeRef.current;
        const nextRootTree =
          !baseRootTree || activePath.length === 0
            ? nextTree
            : updateTreeAtPath(baseRootTree, activePath, () => nextTree);
        rootTreeRef.current = nextRootTree;
        return nextRootTree;
      });
      return nextTree;
    },
    [pushUndoSnapshot]
  );

  const applySelectionState = useCallback(
    (selectedNodeIds: Set<string>, selectedEdgeIds: Set<string>) => {
      const nextSelectedNodeIds = new Set(selectedNodeIds);
      const nextSelectedEdgeIds = new Set(selectedEdgeIds);
      selectedNodeIdsRef.current = nextSelectedNodeIds;
      selectedEdgeIdsRef.current = nextSelectedEdgeIds;
      if (nextSelectedNodeIds.size === 0 && nextSelectedEdgeIds.size === 0) {
        setSelectionActionAnchor(null);
      }

      setNodes((currentNodes) => {
        const nextNodes = currentNodes.map((node) => ({
          ...node,
          selected: nextSelectedNodeIds.has(node.id),
          data: {
            ...node.data,
            isHighlighted: nextSelectedNodeIds.has(node.id),
          },
        }));
        setSelectedNodes(
          nextNodes
            .filter((candidate) => nextSelectedNodeIds.has(candidate.id))
            .map((candidate) => ({ ...candidate, selected: true, dragging: false }))
        );

        setEdges((currentEdges) => {
          const nextEdges = currentEdges.map((edge) => ({
            ...edge,
            selected: nextSelectedEdgeIds.has(edge.id),
          }));
          setSelectedEdges(
            nextEdges
              .filter((candidate) => nextSelectedEdgeIds.has(candidate.id))
              .map((candidate) => ({ ...candidate, selected: true }))
          );

          currentTreeRef.current = currentTreeRef.current
            ? { ...currentTreeRef.current, nodes: nextNodes, edges: nextEdges }
            : currentTreeRef.current;
          setCurrentTree((previousTree) =>
            previousTree ? { ...previousTree, nodes: nextNodes, edges: nextEdges } : previousTree
          );

          return nextEdges;
        });

        return nextNodes;
      });
    },
    []
  );

  const commitSelectionState = useCallback(
    (selectedNodeIds: Set<string>, selectedEdgeIds: Set<string>) => {
      applySelectionState(selectedNodeIds, selectedEdgeIds);
    },
    [applySelectionState]
  );

  const getManualEdgeSelectionOverride = useCallback(() => {
    const override = manualEdgeSelectionRef.current;
    if (!override) return null;

    if (Date.now() > override.expiresAt) {
      manualEdgeSelectionRef.current = null;
      return null;
    }

    return {
      nodeIds: new Set(override.nodeIds),
      edgeIds: new Set(override.edgeIds),
    };
  }, []);

  const loadRootTree = useCallback(
    (tree: BehaviorTree) => {
      const hydrated: BehaviorTree = {
        ...tree,
        nodes: resetTransientNodeState(tree.nodes),
        edges: resetTransientEdgeState(tree.edges),
      };
      syncRootTreeAndEditor(hydrated, [], { center: true });
    },
    [resetTransientEdgeState, resetTransientNodeState, syncRootTreeAndEditor]
  );

  const addNodeAtPosition = useCallback(
    (
      nodeType: BehaviorNodeType,
      position: { x: number; y: number },
      item?: ROSNodeInfo | BehaviorTree,
      options: { avoidOverlap?: boolean } = {}
    ) => {
      const existingBehaviorNodes = nodes as BehaviorTreeNode[];
      const nextPosition = options.avoidOverlap
        ? findOpenPaletteAddPosition(position, existingBehaviorNodes)
        : position;

      if (nodeType === BehaviorNodeType.Subtree && item && 'nodes' in item && 'edges' in item) {
        const subtreeNode = createSubtreeNode({
          id: allocateNodeId(nodes),
          label: item.name,
          position: nextPosition,
          tree: cloneBehaviorTree(item),
          sourceTreeId: item.id,
        });
        persistEditorTree([...nodes, subtreeNode], edges);
        return;
      }

      const newNode = createBehaviorTreeNode({
        id: allocateNodeId(nodes),
        nodeType,
        position: nextPosition,
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
      if (isExecuting) return;
      const source = nodes.find(node => node.id === connection.source);
      if (!source) return;
      if (source.type === BehaviorNodeType.Timeout && edges.some(edge => edge.source === source.id)) return;
      if (source.type === BehaviorNodeType.IfElse) {
        const handle = connection.sourceHandle;
        if (!handle || !['then', 'else'].includes(handle)) return;
        if (edges.some(edge => edge.source === source.id && edge.sourceHandle === handle)) return;
        persistEditorTree(nodes, addEdge(connection, edges));
        return;
      }
      persistEditorTree(nodes, addEdge(normalizeEdge(connection), edges));
    },
    [edges, isExecuting, nodes, persistEditorTree]
  );

  const getCurrentSelectionRect = useCallback((): DOMRect | null => {
    if (customBoxSelectionRectRef.current) {
      return customBoxSelectionRectRef.current;
    }

    const canvas = reactFlowWrapper.current;
    const selectionElement = canvas?.querySelector<HTMLElement>('.react-flow__selection');
    if (!canvas || !selectionElement) return null;

    const selectionRect = selectionElement.getBoundingClientRect();
    return selectionRect && (selectionRect.width > 0 || selectionRect.height > 0)
      ? selectionRect
      : null;
  }, []);

  const getPartiallyEnclosedBoxNodeIds = useCallback((): Set<string> | null => {
    const canvas = reactFlowWrapper.current;
    const selectionRect = getCurrentSelectionRect();
    if (!canvas || !selectionRect) return null;

    const knownNodeIds = new Set(nodes.map((node) => node.id));
    const selectedNodeIds = new Set<string>();
    let sawMeasurableNode = false;

    canvas.querySelectorAll<HTMLElement>('.react-flow__node').forEach((nodeElement) => {
      const nodeId = getKnownReactFlowElementId(nodeElement, knownNodeIds, [
        'rf__node-',
        'rf-node-',
      ]);
      if (!nodeId) return;

      const nodeRect = nodeElement.getBoundingClientRect();
      if (nodeRect.width <= 0 && nodeRect.height <= 0) return;
      sawMeasurableNode = true;

      if (rectsIntersect(nodeRect, selectionRect)) {
        selectedNodeIds.add(nodeId);
      }
    });

    return sawMeasurableNode ? selectedNodeIds : null;
  }, [getCurrentSelectionRect, nodes]);

  const getEdgesWithSelectedEndpoints = useCallback(
    (selectedNodeIds: Set<string>) =>
      new Set(
        edges
          .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
          .map((edge) => edge.id)
      ),
    [edges]
  );

  const getFullyEnclosedBoxEdgeIds = useCallback((): Set<string> | null => {
    const canvas = reactFlowWrapper.current;
    const selectionRect = getCurrentSelectionRect();
    if (!canvas || !selectionRect) return null;

    const knownEdgeIds = new Set(edges.map((edge) => edge.id));
    const selectedEdgeIds = new Set<string>();
    let sawMeasurableEdge = false;

    canvas.querySelectorAll<SVGGElement>('.react-flow__edge').forEach((edgeElement) => {
      const edgeId = getKnownReactFlowElementId(edgeElement, knownEdgeIds, [
        'rf__edge-',
        'rf-edge-',
      ]);
      if (!edgeId) return;

      const edgeRect = edgeElement.getBoundingClientRect();
      if (edgeRect.width <= 0 && edgeRect.height <= 0) return;
      sawMeasurableEdge = true;

      if (rectFullyContains(selectionRect, edgeRect)) {
        selectedEdgeIds.add(edgeId);
      }
    });

    return sawMeasurableEdge ? selectedEdgeIds : null;
  }, [edges, getCurrentSelectionRect]);

  const getBoxSelectionNodeIds = useCallback(
    (fallbackNodeIds: Set<string>) => {
      const measuredNodeIds = getPartiallyEnclosedBoxNodeIds();
      if (measuredNodeIds) {
        boxSelectionNodeIdsRef.current = new Set(measuredNodeIds);
        return measuredNodeIds;
      }

      return boxSelectionNodeIdsRef.current
        ? new Set(boxSelectionNodeIdsRef.current)
        : new Set(fallbackNodeIds);
    },
    [getPartiallyEnclosedBoxNodeIds]
  );

  const getBoxSelectionEdgeIds = useCallback(
    (selectedNodeIds: Set<string>) => {
      const measuredEdgeIds = getFullyEnclosedBoxEdgeIds();
      if (measuredEdgeIds) {
        boxSelectionEdgeIdsRef.current = new Set(measuredEdgeIds);
        return measuredEdgeIds;
      }

      if (boxSelectionEdgeIdsRef.current) {
        return new Set(boxSelectionEdgeIdsRef.current);
      }

      return getEdgesWithSelectedEndpoints(selectedNodeIds);
    },
    [getEdgesWithSelectedEndpoints, getFullyEnclosedBoxEdgeIds]
  );

  const shouldIgnoreRecentBoxSelectionReduction = useCallback(
    (nextSelectedNodeIds: Set<string>, nextSelectedEdgeIds: Set<string>) => {
      if (boxSelectionPointerDownRef.current && boxSelectionEndPendingRef.current) {
        return (
          nextSelectedNodeIds.size < selectedNodeIdsRef.current.size ||
          nextSelectedEdgeIds.size < selectedEdgeIdsRef.current.size
        );
      }
      if (boxSelectionActiveRef.current) return false;
      if (Date.now() - boxSelectionEndedAtRef.current > BOX_SELECTION_CLEAR_SUPPRESSION_MS) {
        return false;
      }

      return (
        nextSelectedNodeIds.size < selectedNodeIdsRef.current.size ||
        nextSelectedEdgeIds.size < selectedEdgeIdsRef.current.size
      );
    },
    []
  );

  const onNodesChange = useCallback(
    (changes: Parameters<typeof applyNodeChanges>[0]) => {
      const previewMeasurements = changes.flatMap(change => {
        if (change.type !== 'dimensions' || !isAgentPreviewChange(change) || !change.dimensions) return [];
        return [{ id: change.id, dimensions: change.dimensions }];
      });
      if (previewMeasurements.length > 0) {
        setAgentPreviewDimensions(previous => {
          let changed = false;
          const next = { ...previous };
          previewMeasurements.forEach(({ id, dimensions }) => {
            const current = previous[id];
            if (current?.width === dimensions.width && current.height === dimensions.height) return;
            next[id] = dimensions;
            changed = true;
          });
          return changed ? next : previous;
        });
      }

      const editorChanges = changes.filter(change => !isAgentPreviewChange(change));
      if (editorChanges.length === 0) return;
      const nextNodes = (applyNodeChanges(editorChanges, nodes) as BehaviorTreeNode[])
        .filter(node => !node.id.startsWith(AGENT_PREVIEW_ID_PREFIX));

      const shouldOnlyUpdateViewportState = editorChanges.every((change) => {
        if (change.type === 'select' || change.type === 'dimensions') return true;
        return change.type === 'position' && 'dragging' in change && change.dragging === true;
      });

      if (editorChanges.every((change) => change.type === 'select')) {
        const manualEdgeSelection = getManualEdgeSelectionOverride();
        if (manualEdgeSelection) {
          commitSelectionState(manualEdgeSelection.nodeIds, manualEdgeSelection.edgeIds);
          return;
        }

        const flowSelectedNodeIds = new Set(
          nextNodes.filter((node) => node.selected).map((node) => node.id)
        );
        const selectedNodeIds = boxSelectionActiveRef.current
          ? getBoxSelectionNodeIds(flowSelectedNodeIds)
          : flowSelectedNodeIds;
        const selectedEdgeIds = boxSelectionActiveRef.current
          ? getBoxSelectionEdgeIds(selectedNodeIds)
          : selectedEdgeIdsRef.current;
        if (shouldIgnoreRecentBoxSelectionReduction(selectedNodeIds, selectedEdgeIds)) return;
        commitSelectionState(selectedNodeIds, selectedEdgeIds);
        return;
      }

      if (shouldOnlyUpdateViewportState) {
        setNodes(
          nextNodes.map((node) => ({
            ...node,
            selected: selectedNodeIdsRef.current.has(node.id),
            data: {
              ...node.data,
              isHighlighted: selectedNodeIdsRef.current.has(node.id),
            },
          }))
        );
        return;
      }

      if (isExecuting) return;
      persistEditorTree(nextNodes, edges);
    },
    [
      commitSelectionState,
      edges,
      getManualEdgeSelectionOverride,
      getBoxSelectionEdgeIds,
      getBoxSelectionNodeIds,
      isExecuting,
      nodes,
      persistEditorTree,
      shouldIgnoreRecentBoxSelectionReduction,
    ]
  );

  const onEdgesChange = useCallback(
    (changes: Parameters<typeof applyEdgeChanges>[0]) => {
      const editorChanges = changes.filter(change => !isAgentPreviewChange(change));
      if (editorChanges.length === 0) return;
      const nextEdges = applyEdgeChanges(editorChanges, edges)
        .filter(edge => !edge.id.startsWith(AGENT_PREVIEW_ID_PREFIX));

      if (editorChanges.every((change) => change.type === 'select')) {
        const manualEdgeSelection = getManualEdgeSelectionOverride();
        if (manualEdgeSelection) {
          commitSelectionState(manualEdgeSelection.nodeIds, manualEdgeSelection.edgeIds);
          return;
        }

        const selectedNodeIds = selectedNodeIdsRef.current;
        const selectedEdgeIds = boxSelectionActiveRef.current
          ? getBoxSelectionEdgeIds(selectedNodeIds)
          : new Set(nextEdges.filter((edge) => edge.selected).map((edge) => edge.id));
        if (shouldIgnoreRecentBoxSelectionReduction(selectedNodeIds, selectedEdgeIds)) return;
        commitSelectionState(selectedNodeIds, selectedEdgeIds);
        return;
      }

      if (isExecuting) return;
      persistEditorTree(nodes, nextEdges);
    },
    [
      commitSelectionState,
      edges,
      getManualEdgeSelectionOverride,
      getBoxSelectionEdgeIds,
      isExecuting,
      nodes,
      persistEditorTree,
      shouldIgnoreRecentBoxSelectionReduction,
    ]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (isExecuting) return;

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
    [addNodeAtPosition, isExecuting, screenToFlowPosition]
  );

  const onNodesDelete = useCallback(
    (_deleted: Node[]) => {
      // React Flow handles cleanup internally; keep for logging if needed
    },
    []
  );

  // Track selected nodes for the delete button
  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: selectedFlowEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const manualEdgeSelection = getManualEdgeSelectionOverride();
      if (manualEdgeSelection) {
        commitSelectionState(manualEdgeSelection.nodeIds, manualEdgeSelection.edgeIds);
        return;
      }

      const flowSelectedNodeIds = new Set(sel.map((node) => node.id));
      const selectedNodeIds = boxSelectionActiveRef.current
        ? getBoxSelectionNodeIds(flowSelectedNodeIds)
        : flowSelectedNodeIds;
      const selectedEdgeIds = boxSelectionActiveRef.current
        ? getBoxSelectionEdgeIds(selectedNodeIds)
        : new Set(selectedFlowEdges.map((edge) => edge.id));

      if (shouldIgnoreRecentBoxSelectionReduction(selectedNodeIds, selectedEdgeIds)) return;
      commitSelectionState(selectedNodeIds, selectedEdgeIds);
    },
    [
      commitSelectionState,
      getManualEdgeSelectionOverride,
      getBoxSelectionEdgeIds,
      getBoxSelectionNodeIds,
      shouldIgnoreRecentBoxSelectionReduction,
    ]
  );

  const finalizeBoxSelection = useCallback(() => {
    if (!boxSelectionActiveRef.current) return;

    const selectedNodeIds = getBoxSelectionNodeIds(new Set(selectedNodeIdsRef.current));
    const selectedEdgeIds = getBoxSelectionEdgeIds(selectedNodeIds);
    commitSelectionState(selectedNodeIds, selectedEdgeIds);
    boxSelectionActiveRef.current = false;
    boxSelectionEndPendingRef.current = false;
    boxSelectionEndedAtRef.current =
      selectedNodeIds.size > 0 || selectedEdgeIds.size > 0 ? Date.now() : 0;
  }, [commitSelectionState, getBoxSelectionEdgeIds, getBoxSelectionNodeIds]);

  const handleSelectionStart = useCallback((event?: React.MouseEvent | React.TouchEvent) => {
    if (event) {
      boxSelectionPointerDownRef.current = true;
      boxSelectionEndPendingRef.current = false;
    }
    boxSelectionActiveRef.current = true;
    boxSelectionNodeIdsRef.current = null;
    boxSelectionEdgeIdsRef.current = null;
    boxSelectionEndedAtRef.current = 0;
    manualEdgeSelectionRef.current = null;
    setOrderingParentId(null);
    setSelectionActionAnchor(null);
    commitSelectionState(new Set(), new Set());
  }, [commitSelectionState]);

  const handleSelectionEnd = useCallback(() => {
    if (!boxSelectionActiveRef.current) return;
    if (boxSelectionPointerDownRef.current) {
      boxSelectionEndPendingRef.current = true;
      return;
    }

    finalizeBoxSelection();
  }, [finalizeBoxSelection]);

  // Delete selected nodes (and their connected edges)
  const handleDeleteSelected = useCallback(() => {
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    if (selectedIds.size === 0 && selectedEdgeIds.size === 0) return;

    persistEditorTree(
      nodes.filter((node) => !selectedIds.has(node.id)),
      edges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedIds.has(edge.source) &&
          !selectedIds.has(edge.target)
      )
    );
    setSelectedNodes([]);
    setSelectedEdges([]);
    selectedNodeIdsRef.current = new Set();
    selectedEdgeIdsRef.current = new Set();
  }, [edges, nodes, persistEditorTree, selectedEdges, selectedNodes]);

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
    selectedNodeIdsRef.current = new Set(result.duplicatedNodes.map((node) => node.id));
    selectedEdgeIdsRef.current = new Set();
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
    const activeRootTree = rootTreeRef.current;
    const activePath = treePathRef.current;
    if (!activeRootTree) return;
    const nextPath = [...activePath, subtreeNodeId];
    const nextTree = getTreeAtPath(activeRootTree, nextPath);
    if (!nextTree) return;

    syncEditorState(nextTree, nextPath, { center: true });
  }, [syncEditorState]);

  const handleOpenSelectedSubtree = useCallback(() => {
    if (selectedNodes.length !== 1) return;
    const selectedNode = nodes.find((node) => node.id === selectedNodes[0].id);
    if (!isSubtreeNode(selectedNode)) return;
    openSubtreeNode(selectedNode.id);
  }, [nodes, openSubtreeNode, selectedNodes]);

  const openNodeEditor = useCallback((node: Node) => {
    if (isSubtreeNode(node as BehaviorTreeNode)) {
      openSubtreeNode(node.id);
    } else if (isExecuting) {
      return;
    } else if (node.type === BehaviorNodeType.Action) {
      setEditingAction({ nodeId: node.id, data: node.data as ROSActionNodeData });
    } else if (node.type === BehaviorNodeType.Service) {
      setEditingService({ nodeId: node.id, data: node.data as ROSServiceNodeData });
    } else if (
      node.type === BehaviorNodeType.Topic ||
      node.type === BehaviorNodeType.Subscriber ||
      node.type === BehaviorNodeType.Timeout ||
      node.type === BehaviorNodeType.IfElse
    ) {
      setEditingConfigNodeId(node.id);
    } else if (isIteratingControlNode(node)) {
      setEditingIterationNodeId(node.id);
    } else if (isOrderedControlNode(node as BehaviorTreeNode)) {
      setOrderingParentId(node.id);
    }
  }, [isExecuting, openSubtreeNode]);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      openNodeEditor(node);
    },
    [openNodeEditor]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      manualEdgeSelectionRef.current = null;
      setOrderingParentId(null);

      if (event.ctrlKey || event.metaKey) {
        const nextSelectedNodeIds = new Set(
          nodeMultiSelectSnapshotRef.current ?? selectedNodeIdsRef.current
        );
        const nextSelectedEdgeIds = new Set(selectedEdgeIdsRef.current);

        if (nextSelectedNodeIds.has(node.id)) {
          nextSelectedNodeIds.delete(node.id);
        } else {
          nextSelectedNodeIds.add(node.id);
        }

        nodeMultiSelectSnapshotRef.current = null;
        manualEdgeSelectionRef.current = {
          nodeIds: nextSelectedNodeIds,
          edgeIds: nextSelectedEdgeIds,
          expiresAt: Date.now() + MANUAL_EDGE_SELECTION_SUPPRESSION_MS,
        };
        commitSelectionState(nextSelectedNodeIds, nextSelectedEdgeIds);
        return;
      }

      nodeMultiSelectSnapshotRef.current = null;

      if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
      if (
        node.type !== BehaviorNodeType.Action &&
        node.type !== BehaviorNodeType.Service &&
        node.type !== BehaviorNodeType.Topic &&
        node.type !== BehaviorNodeType.Subscriber &&
        node.type !== BehaviorNodeType.Timeout &&
        node.type !== BehaviorNodeType.IfElse &&
        node.type !== BehaviorNodeType.Subtree &&
        !isIteratingControlNode(node) &&
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
    [commitSelectionState, openNodeEditor]
  );

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    setOrderingParentId(null);

    const isMultiSelect = event.ctrlKey || event.metaKey;
    const nextSelectedNodeIds = isMultiSelect
      ? new Set(selectedNodeIdsRef.current)
      : new Set<string>();
    const nextSelectedEdgeIds = isMultiSelect
      ? new Set(selectedEdgeIdsRef.current)
      : new Set<string>();

    if (isMultiSelect && nextSelectedEdgeIds.has(edge.id)) {
      nextSelectedEdgeIds.delete(edge.id);
    } else {
      nextSelectedEdgeIds.add(edge.id);
    }

    manualEdgeSelectionRef.current = {
      nodeIds: nextSelectedNodeIds,
      edgeIds: nextSelectedEdgeIds,
      expiresAt: Date.now() + MANUAL_EDGE_SELECTION_SUPPRESSION_MS,
    };
    commitSelectionState(nextSelectedNodeIds, nextSelectedEdgeIds);
  }, [commitSelectionState]);

  const handleSaveActionParameters = useCallback(
    (parameters: Record<string, any>, inputBindings: BlackboardInputBinding[] = [], outputBindings: BlackboardOutputBinding[] = []) => {
      if (!editingAction) return;
      const { nodeId } = editingAction;
      persistEditorTree(
        nodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, parameters, inputBindings, outputBindings } };
        }),
        edges
      );
    },
    [editingAction, edges, nodes, persistEditorTree]
  );

  const handleSaveServiceRequest = useCallback(
    (request: Record<string, any>, inputBindings: BlackboardInputBinding[] = [], outputBindings: BlackboardOutputBinding[] = []) => {
      if (!editingService) return;
      const { nodeId } = editingService;
      persistEditorTree(
        nodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, request, inputBindings, outputBindings } };
        }),
        edges
      );
    },
    [editingService, edges, nodes, persistEditorTree]
  );

  const editingConfigNode = useMemo(
    () => (nodes as BehaviorTreeNode[]).find(node => node.id === editingConfigNodeId) ?? null,
    [nodes, editingConfigNodeId]
  );

  const handleSaveNodeConfig = useCallback((data: BehaviorTreeNode['data']) => {
    if (!editingConfigNodeId) return;
    persistEditorTree(
      nodes.map(node => node.id === editingConfigNodeId ? { ...node, data } : node),
      edges
    );
  }, [editingConfigNodeId, edges, nodes, persistEditorTree]);

  const handleBlackboardDefaultsChange = useCallback((defaults: Record<string, unknown>) => {
    persistEditorTree(nodes, edges, { blackboardDefaults: defaults });
  }, [edges, nodes, persistEditorTree]);

  const handleSave = useCallback(() => {
    const activeTree = currentTreeRef.current;
    const activePath = treePathRef.current;
    const activeRootTree = rootTreeRef.current;
    if (!activeTree) return;

    const updatedTree: BehaviorTree = {
      ...activeTree,
      nodes: nodes as BehaviorTreeNode[],
      edges,
      updatedAt: Date.now(),
    };
    const success = saveBehaviorTree(updatedTree);
    if (success) {
      syncBehaviorTreeReferences(updatedTree);

      const syncedRootTree = activeRootTree
        ? syncReferencedSubtrees(
            activePath.length === 0 ? updatedTree : updateTreeAtPath(activeRootTree, activePath, () => updatedTree),
            updatedTree
          )
        : updatedTree;

      syncRootTreeAndEditor(syncedRootTree, activePath);

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
  }, [edges, nodes, showSaveNotice, syncRootTreeAndEditor]);

  const handleLoad = useCallback((tree: BehaviorTree) => {
    pushUndoSnapshot();
    loadRootTree(tree);
  }, [loadRootTree, pushUndoSnapshot]);

  const handleNew = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0) {
      if (!window.confirm('Create new tree? Unsaved changes will be lost.')) {
        return;
      }
    }
    pushUndoSnapshot();

    const newTree: BehaviorTree = {
      id: uuidv4(),
      name: 'Untitled Behavior Tree',
      nodes: [],
      edges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    loadRootTree(newTree);
  }, [edges.length, loadRootTree, nodes.length, pushUndoSnapshot]);

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
    const activeTree = currentTreeRef.current;
    const activePath = treePathRef.current;
    if (!activeTree) return;
    pushUndoSnapshot();

    const nextTree = { ...activeTree, name };
    currentTreeRef.current = nextTree;
    setCurrentTree(nextTree);
    setRootTree((previousRootTree) => {
      const baseRootTree = previousRootTree ?? rootTreeRef.current;
      if (!baseRootTree || activePath.length === 0) {
        rootTreeRef.current = nextTree;
        return nextTree;
      }

      const renamedRootTree = replaceTreeAtPath(baseRootTree, activePath, nextTree);
      const subtreeNodeId = activePath[activePath.length - 1];
      const parentPath = activePath.slice(0, -1);
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
  }, [pushUndoSnapshot]);

  const followExecutionNode = useCallback(
    (nodeId: string) => {
      const activeTree = currentTreeRef.current;
      const node = activeTree?.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;

      const position = node.positionAbsolute ?? node.position;
      const centerX = position.x + (node.width ?? 150) / 2;
      const centerY = position.y + (node.height ?? 80) / 2;

      if (followExecutionFrameRef.current !== null) {
        window.cancelAnimationFrame(followExecutionFrameRef.current);
      }

      followExecutionFrameRef.current = window.requestAnimationFrame(() => {
        followExecutionFrameRef.current = null;
        const zoom = getZoom();
        setCenter(centerX, centerY, {
          zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
          duration: 360,
        });
      });
    },
    [getZoom, setCenter]
  );

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

        const isVisibleExecutionPath = areTreePathsEqual(eventPath, treePathRef.current);
        if (isVisibleExecutionPath) {
          updateDisplayedNodeStatus(nodeId, status);
        }

        if (status === ExecutionStatus.Running) {
          if (isVisibleExecutionPath && isFollowModeRef.current) {
            followExecutionNode(nodeId);
          }

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

      if (event.type === 'blackboardUpdated' && event.data?.blackboard) {
        setLiveBlackboard(event.data.blackboard as Record<string, unknown>);
      }

      if (event.type === 'started') {
        setIsPaused(false);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: true,
          status: ExecutionStatus.Running,
          startedAt: executionStartedAt.current,
        }));
      } else if (event.type === 'paused') {
        setIsPaused(true);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: true,
          isPaused: true,
          status: 'paused',
        }));
      } else if (event.type === 'resumed') {
        setIsPaused(false);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: true,
          isPaused: false,
          status: ExecutionStatus.Running,
        }));
      } else if (event.type === 'completed' || event.type === 'stopped' || event.type === 'error') {
        const status = event.type;
        setIsExecuting(false);
        setIsPaused(false);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: false,
          isPaused: false,
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
    [followExecutionNode, resetTransientEdgeState, resetTransientNodeState, updateDisplayedNodeStatus]
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
    setLiveBlackboard(treeToExecute.blackboardDefaults || {});
    executorRef.current = new BehaviorTreeExecutor(treeToExecute, ros, handleExecutionEvent);
    setIsExecuting(true);
    setIsPaused(false);
    setExecutionSnapshot({
      isExecuting: true,
      isPaused: false,
      treeName: treeToExecute.name,
      activeNodeLabel: 'Starting',
      status: ExecutionStatus.Running,
      startedAt: executionStartedAt.current,
    });
    executorRef.current.start();
  }, [ros, isConnected, currentTree, nodes, edges, handleExecutionEvent]);

  const handlePause = useCallback(() => {
    executorRef.current?.pause();
  }, []);

  const handleResume = useCallback(() => {
    executorRef.current?.resume();
  }, []);

  const handleStop = useCallback(() => {
    if (executorRef.current) executorRef.current.stop();
    setIsExecuting(false);
    setIsPaused(false);
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
      isPaused: false,
      status: 'stopped',
    }));
  }, [resetTransientEdgeState, resetTransientNodeState]);

  const restoreRootTreeSnapshot = useCallback(
    (snapshot: HistorySnapshot) => {
      const activeTree = snapshot.activeTree;
      const snapshotTree =
        activeTree && snapshot.path.length > 0
          ? updateTreeAtPath(snapshot.tree, snapshot.path, () => activeTree)
          : snapshot.tree;

      syncRootTreeAndEditor(snapshotTree, snapshot.path);
    },
    [syncRootTreeAndEditor]
  );

  const handleUndo = useCallback(() => {
    const previousSnapshot = undoHistoryRef.current.pop();
    const redoSnapshot = createHistorySnapshot();
    if (!previousSnapshot || !redoSnapshot) return;

    redoHistoryRef.current = [
      ...redoHistoryRef.current.slice(-(MAX_UNDO_HISTORY - 1)),
      redoSnapshot,
    ];

    isRestoringHistory.current = true;
    restoreRootTreeSnapshot(previousSnapshot);
    setCanUndo(undoHistoryRef.current.length > 0);
    setCanRedo(true);
    isRestoringHistory.current = false;
  }, [createHistorySnapshot, restoreRootTreeSnapshot]);

  const handleRedo = useCallback(() => {
    const nextSnapshot = redoHistoryRef.current.pop();
    const undoSnapshot = createHistorySnapshot();
    if (!nextSnapshot || !undoSnapshot) return;

    undoHistoryRef.current = [
      ...undoHistoryRef.current.slice(-(MAX_UNDO_HISTORY - 1)),
      undoSnapshot,
    ];

    isRestoringHistory.current = true;
    restoreRootTreeSnapshot(nextSnapshot);
    setCanUndo(true);
    setCanRedo(redoHistoryRef.current.length > 0);
    isRestoringHistory.current = false;
  }, [createHistorySnapshot, restoreRootTreeSnapshot]);

  useEffect(() => {
    onExecutionChange?.(executionSnapshot);
  }, [executionSnapshot, onExecutionChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (isEditableTarget) return;

      if (!isExecuting && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRedo, handleUndo, isExecuting]);

  useEffect(() => {
    onExecutionControlsChange?.({ stop: handleStop });
    return () => onExecutionControlsChange?.(null);
  }, [handleStop, onExecutionControlsChange]);

  const updateCustomBoxSelection = useCallback(
    (gesture: CustomBoxSelectionGesture) => {
      const canvas = reactFlowWrapper.current;
      if (!canvas) return;

      const left = Math.min(gesture.startX, gesture.currentX);
      const right = Math.max(gesture.startX, gesture.currentX);
      const top = Math.min(gesture.startY, gesture.currentY);
      const bottom = Math.max(gesture.startY, gesture.currentY);
      const selectionRect = createViewportRect(left, top, right, bottom);
      const canvasRect = canvas.getBoundingClientRect();

      customBoxSelectionRectRef.current = selectionRect;
      setCustomBoxSelection({
        left: left - canvasRect.left,
        top: top - canvasRect.top,
        width: selectionRect.width,
        height: selectionRect.height,
      });

      if (!gesture.didDrag) return;

      const selectedNodeIds = getBoxSelectionNodeIds(new Set());
      const selectedEdgeIds = getBoxSelectionEdgeIds(selectedNodeIds);
      commitSelectionState(selectedNodeIds, selectedEdgeIds);
    },
    [commitSelectionState, getBoxSelectionEdgeIds, getBoxSelectionNodeIds]
  );

  const finishCustomBoxSelection = useCallback((): boolean => {
    const gesture = customBoxSelectionGestureRef.current;
    if (!gesture) return false;

    updateCustomBoxSelection(gesture);

    if (typeof gesture.element.hasPointerCapture === 'function' &&
      gesture.element.hasPointerCapture(gesture.pointerId) &&
      typeof gesture.element.releasePointerCapture === 'function'
    ) {
      gesture.element.releasePointerCapture(gesture.pointerId);
    }

    customBoxSelectionGestureRef.current = null;
    customBoxSelectionRectRef.current = null;
    setCustomBoxSelection(null);
    boxSelectionActiveRef.current = false;
    boxSelectionPointerDownRef.current = false;
    boxSelectionEndPendingRef.current = false;
    boxSelectionEndedAtRef.current =
      gesture.didDrag && (selectedNodeIdsRef.current.size > 0 || selectedEdgeIdsRef.current.size > 0)
        ? Date.now()
        : 0;

    return true;
  }, [updateCustomBoxSelection]);

  const releaseBoxSelectionPointer = useCallback(() => {
    if (finishCustomBoxSelection()) return;

    if (!boxSelectionPointerDownRef.current) return;
    boxSelectionPointerDownRef.current = false;

    if (boxSelectionActiveRef.current || boxSelectionEndPendingRef.current) {
      finalizeBoxSelection();
    }
  }, [finalizeBoxSelection, finishCustomBoxSelection]);

  useEffect(() => {
    document.addEventListener('pointerup', releaseBoxSelectionPointer);
    document.addEventListener('pointercancel', releaseBoxSelectionPointer);
    window.addEventListener('blur', releaseBoxSelectionPointer);

    return () => {
      document.removeEventListener('pointerup', releaseBoxSelectionPointer);
      document.removeEventListener('pointercancel', releaseBoxSelectionPointer);
      window.removeEventListener('blur', releaseBoxSelectionPointer);
    };
  }, [releaseBoxSelectionPointer]);

  useEffect(() => {
    return () => {
      if (executorRef.current) executorRef.current.stop();
      boxSelectionActiveRef.current = false;
      boxSelectionNodeIdsRef.current = null;
      boxSelectionEdgeIdsRef.current = null;
      boxSelectionEndedAtRef.current = 0;
      boxSelectionPointerDownRef.current = false;
      boxSelectionEndPendingRef.current = false;
      if (subtreeReturnAnchorFrameRef.current !== null) {
        window.cancelAnimationFrame(subtreeReturnAnchorFrameRef.current);
      }
      if (followExecutionFrameRef.current !== null) {
        window.cancelAnimationFrame(followExecutionFrameRef.current);
      }
    };
  }, []);

  // Add a node at the centre of the visible canvas — used for mobile tap-to-add.
  const handleAddNode = useCallback(
    (
      nodeType: BehaviorNodeType,
      item?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo | BehaviorTree
    ) => {
      if (isExecuting) return;
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });

      addNodeAtPosition(nodeType, position, item, { avoidOverlap: true });

      // Close palette on mobile after adding
      if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
        setIsPaletteCollapsed(true);
      }
    },
    [addNodeAtPosition, isExecuting, screenToFlowPosition]
  );

  const behaviorNodes = useMemo(() => nodes as BehaviorTreeNode[], [nodes]);
  const agentPreviewDiff = useMemo(
    () => agentPreviewTree && currentTree ? buildTreeDiff(currentTree, agentPreviewTree) : null,
    [agentPreviewTree, currentTree]
  );
  const canvasNodes = useMemo<BehaviorTreeNode[]>(() => {
    if (!agentPreviewTree || !agentPreviewDiff) return behaviorNodes;
    const currentNodeById = new Map(behaviorNodes.map(node => [node.id, node]));
    const proposedNodeById = new Map(agentPreviewTree.nodes.map(node => [node.id, node]));
    const anchorOffsets = Array.from(agentPreviewDiff.currentToProposed.entries()).flatMap(
      ([currentId, proposedId]) => {
        const currentNode = currentNodeById.get(currentId);
        const proposedNode = proposedNodeById.get(proposedId);
        return currentNode && proposedNode
          ? [{ x: currentNode.position.x - proposedNode.position.x, y: currentNode.position.y - proposedNode.position.y }]
          : [];
      }
    );
    const fallbackCurrentRight = Math.max(0, ...behaviorNodes.map(node => node.position.x + (node.width ?? 180)));
    const proposedLeft = Math.min(0, ...agentPreviewTree.nodes.map(node => node.position.x));
    const previewOffset = anchorOffsets.length > 0
      ? {
          x: anchorOffsets.reduce((sum, offset) => sum + offset.x, 0) / anchorOffsets.length,
          y: anchorOffsets.reduce((sum, offset) => sum + offset.y, 0) / anchorOffsets.length,
        }
      : { x: fallbackCurrentRight - proposedLeft + 100, y: 0 };
    const currentNodes = behaviorNodes.map(node => {
      const change = agentPreviewDiff.currentNodes.get(node.id);
      if (change === 'removed') {
        return { ...node, className: `${node.className ?? ''} bt-agent-canvas-removed`.trim() };
      }
      if (change === 'changed') {
        const proposedId = agentPreviewDiff.currentToProposed.get(node.id);
        const proposedNode = proposedId ? proposedNodeById.get(proposedId) : undefined;
        if (proposedNode) {
          return {
            ...node,
            type: proposedNode.type,
            className: `${node.className ?? ''} bt-agent-canvas-changed`.trim(),
            data: {
              ...proposedNode.data,
              isHighlighted: node.data.isHighlighted,
              status: node.data.status,
            },
          };
        }
      }
      return node;
    });
    const proposedNodes = agentPreviewTree.nodes.flatMap(node => {
      const change = agentPreviewDiff.proposedNodes.get(node.id) ?? 'added';
      if (change !== 'added') return [];
      const previewId = `${AGENT_PREVIEW_ID_PREFIX}${node.id}`;
      const measured = agentPreviewDimensions[previewId];
      return [{
        ...node,
        id: previewId,
        position: {
          x: node.position.x + previewOffset.x,
          y: node.position.y + previewOffset.y,
        },
        width: measured?.width ?? node.width,
        height: measured?.height ?? node.height,
        className: `${node.className ?? ''} bt-agent-canvas-proposed bt-agent-canvas-added`.trim(),
        selectable: false,
        draggable: false,
        connectable: false,
        deletable: false,
        focusable: false,
        data: { ...node.data, isHighlighted: false },
      }];
    });
    return [...currentNodes, ...proposedNodes];
  }, [agentPreviewDiff, agentPreviewDimensions, agentPreviewTree, behaviorNodes]);
  const agentPreviewSummary = useMemo(
    () => agentPreviewTree && currentTree ? summarizeTreeChanges(currentTree, agentPreviewTree) : null,
    [agentPreviewTree, currentTree]
  );
  const selectedTreeContext = useMemo<BehaviorTree | null>(() => {
    if (!currentTree || selectedNodes.length === 0) return null;
    const selectedIds = new Set(selectedNodes.map(node => node.id));
    const contextNodes = behaviorNodes.filter(node => selectedIds.has(node.id));
    if (contextNodes.length === 0) return null;

    return {
      ...currentTree,
      id: `${currentTree.id}-selection`,
      name: `${currentTree.name} — selected part`,
      description: `Selected context from ${currentTree.name}`,
      nodes: contextNodes,
      edges: edges.filter(edge => selectedIds.has(edge.source) && selectedIds.has(edge.target)),
    };
  }, [behaviorNodes, currentTree, edges, selectedNodes]);
  const displayedEdges = useMemo(() => {
    const nodeStatusById = new Map(
      behaviorNodes.map((node) => [node.id, node.data.status ?? ExecutionStatus.Idle])
    );

    return annotateOrderedEdges(behaviorNodes, edges).map((edge) => {
      const targetStatus = nodeStatusById.get(edge.target) ?? ExecutionStatus.Idle;
      const isRunning = targetStatus === ExecutionStatus.Running;
      const isSuccess = targetStatus === ExecutionStatus.Success;
      const isFailure = targetStatus === ExecutionStatus.Failure;
      const isSelected = Boolean(edge.selected);

      return {
        ...edge,
        animated: isRunning,
        style: {
          stroke: isSelected
            ? '#ffb300'
            : isRunning
            ? '#ffc107'
            : isSuccess
              ? '#4caf50'
              : isFailure
                ? '#f44336'
                : 'var(--primary-color, #4285f4)',
          strokeWidth: isSelected ? 5 : isRunning ? 4 : isSuccess || isFailure ? 3 : 2,
          opacity: isSelected || isRunning || isSuccess || isFailure ? 1 : 0.9,
        },
      };
    });
  }, [behaviorNodes, edges]);
  const canvasEdges = useMemo(() => {
    if (!agentPreviewTree || !agentPreviewDiff) return displayedEdges;
    const proposedToCurrent = new Map(
      Array.from(agentPreviewDiff.currentToProposed.entries()).map(([currentId, proposedId]) => [proposedId, currentId])
    );
    const canvasNodeIds = new Set(canvasNodes.map(node => node.id));
    const getPreviewEndpoint = (proposedId: string) => {
      const currentId = proposedToCurrent.get(proposedId);
      return currentId ?? `${AGENT_PREVIEW_ID_PREFIX}${proposedId}`;
    };
    const currentEdges = displayedEdges.map(edge =>
      agentPreviewDiff.currentEdges.get(edge.id) === 'removed'
        ? {
            ...edge,
            animated: false,
            className: `${edge.className ?? ''} bt-agent-canvas-edge-removed`.trim(),
            style: { ...edge.style, stroke: '#db4b58', strokeDasharray: '7 5', opacity: .75 },
          }
        : edge
    );
    const proposedEdges = agentPreviewTree.edges
      .filter(edge => agentPreviewDiff.proposedEdges.get(edge.id) === 'added')
      .map(edge => {
        const source = getPreviewEndpoint(edge.source);
        const target = getPreviewEndpoint(edge.target);
        return {
        ...edge,
        id: `${AGENT_PREVIEW_ID_PREFIX}${edge.id}`,
        source,
        target,
        selectable: false,
        deletable: false,
        focusable: false,
        animated: true,
        className: 'bt-agent-canvas-edge-added',
        label: '+',
        labelStyle: { fill: '#2eaa54', fontWeight: 800 },
        style: { stroke: '#2eaa54', strokeWidth: 3, opacity: .9 },
        };
      })
      .filter(edge => canvasNodeIds.has(edge.source) && canvasNodeIds.has(edge.target));
    return [...currentEdges, ...proposedEdges];
  }, [agentPreviewDiff, agentPreviewTree, canvasNodes, displayedEdges]);

  const clearAgentPreview = useCallback(() => {
    setAgentPreviewTree(null);
    setAgentPreviewDimensions({});
  }, []);

  const applyAgentPreview = useCallback((mode: 'replace' | 'subtree') => {
    if (!agentPreviewTree) return;
    if (mode === 'replace') {
      persistEditorTree(agentPreviewTree.nodes, agentPreviewTree.edges, {
        name: agentPreviewTree.name,
        description: agentPreviewTree.description,
        blackboardDefaults: agentPreviewTree.blackboardDefaults,
      });
    } else {
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      addNodeAtPosition(
        BehaviorNodeType.Subtree,
        screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        }),
        agentPreviewTree,
        { avoidOverlap: true }
      );
    }
    setIsAgentOpen(false);
    clearAgentPreview();
    window.requestAnimationFrame(() => centerTreeInView());
  }, [addNodeAtPosition, agentPreviewTree, centerTreeInView, clearAgentPreview, persistEditorTree, screenToFlowPosition]);

  const updateSubtreeReturnAnchor = useCallback(() => {
    if (treePathRef.current.length === 0) {
      setSubtreeReturnAnchor(null);
      return;
    }

    const canvas = reactFlowWrapper.current;
    if (!canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const nodeElements = Array.from(canvas.querySelectorAll<HTMLElement>('.react-flow__node'));

    if (nodeElements.length === 0) {
      setSubtreeReturnAnchor({ x: 16, y: 64 });
      return;
    }

    const bounds = nodeElements.reduce(
      (acc, element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return acc;
        return {
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        };
      },
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    );

    if (!Number.isFinite(bounds.left)) {
      setSubtreeReturnAnchor({ x: 16, y: 64 });
      return;
    }

    const x = Math.min(Math.max(bounds.left - canvasRect.left - 2, 8), Math.max(canvasRect.width - 132, 8));
    const aboveY = bounds.top - canvasRect.top - 46;
    const y =
      aboveY >= 8
        ? aboveY
        : Math.min(Math.max(bounds.bottom - canvasRect.top + 10, 8), Math.max(canvasRect.height - 40, 8));

    setSubtreeReturnAnchor({ x, y });
  }, []);

  const scheduleSubtreeReturnAnchorUpdate = useCallback(() => {
    if (subtreeReturnAnchorFrameRef.current !== null) {
      window.cancelAnimationFrame(subtreeReturnAnchorFrameRef.current);
    }

    subtreeReturnAnchorFrameRef.current = window.requestAnimationFrame(() => {
      subtreeReturnAnchorFrameRef.current = null;
      updateSubtreeReturnAnchor();
    });
  }, [updateSubtreeReturnAnchor]);

  useEffect(() => {
    scheduleSubtreeReturnAnchorUpdate();
  }, [nodes, scheduleSubtreeReturnAnchorUpdate, treePath]);

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
  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      nodeMultiSelectSnapshotRef.current =
        (event.ctrlKey || event.metaKey) && target.closest('.react-flow__node')
          ? new Set(selectedNodeIdsRef.current)
          : null;

      if (canvasInteractionMode !== 'select') return;
      const isNonPrimaryMouseButton =
        event.pointerType === 'mouse' &&
        typeof event.button === 'number' &&
        event.button !== 0;
      if (isNonPrimaryMouseButton) return;

      if (!target.closest('.react-flow')) return;
      if (
        target.closest(
          '.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .bt-node-search, .bt-selection-actions, .bt-subtree-parent-action'
        )
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      customBoxSelectionGestureRef.current = {
        pointerId: event.pointerId,
        element: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        didDrag: false,
      };
      customBoxSelectionRectRef.current = createViewportRect(
        event.clientX,
        event.clientY,
        event.clientX,
        event.clientY
      );
      boxSelectionPointerDownRef.current = true;
      boxSelectionActiveRef.current = true;
      boxSelectionNodeIdsRef.current = null;
      boxSelectionEdgeIdsRef.current = null;
      boxSelectionEndedAtRef.current = 0;
      boxSelectionEndPendingRef.current = false;
      manualEdgeSelectionRef.current = null;
      setCustomBoxSelection(null);
      setOrderingParentId(null);
      setSelectionActionAnchor(null);
      commitSelectionState(new Set(), new Set());
    },
    [canvasInteractionMode, commitSelectionState]
  );

  const handleCanvasPointerMoveCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = customBoxSelectionGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      event.preventDefault();
      event.stopPropagation();

      gesture.currentX = event.clientX;
      gesture.currentY = event.clientY;
      if (
        Math.hypot(gesture.currentX - gesture.startX, gesture.currentY - gesture.startY) >=
        BOX_SELECTION_DRAG_THRESHOLD
      ) {
        gesture.didDrag = true;
      }

      updateCustomBoxSelection(gesture);
    },
    [updateCustomBoxSelection]
  );

  const handleCanvasPointerEndCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = customBoxSelectionGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      gesture.currentX = event.clientX;
      gesture.currentY = event.clientY;
      finishCustomBoxSelection();
    },
    [finishCustomBoxSelection]
  );

  const handlePaneClick = useCallback(() => {
    if (boxSelectionActiveRef.current || boxSelectionPointerDownRef.current) {
      return;
    }

    if (
      Date.now() - boxSelectionEndedAtRef.current <= BOX_SELECTION_CLEAR_SUPPRESSION_MS &&
      (selectedNodeIdsRef.current.size > 0 || selectedEdgeIdsRef.current.size > 0)
    ) {
      return;
    }

    boxSelectionActiveRef.current = false;
    boxSelectionNodeIdsRef.current = null;
    boxSelectionEdgeIdsRef.current = null;
    boxSelectionEndedAtRef.current = 0;
    manualEdgeSelectionRef.current = null;
    setOrderingParentId(null);
    setSelectedNodes([]);
    setSelectedEdges([]);
    applySelectionState(new Set(), new Set());
  }, [applySelectionState]);

  const selectedSubtreeNode = useMemo(() => {
    if (selectedNodes.length !== 1) return null;
    const node = behaviorNodes.find((candidate) => candidate.id === selectedNodes[0].id);
    return isSubtreeNode(node) ? node : null;
  }, [behaviorNodes, selectedNodes]);
  const selectedIterationNode = useMemo(() => {
    if (selectedNodes.length !== 1) return null;
    const node = behaviorNodes.find((candidate) => candidate.id === selectedNodes[0].id);
    return isIteratingControlNode(node) ? node : null;
  }, [behaviorNodes, selectedNodes]);
  const editingIterationNode = useMemo(
    () => behaviorNodes.find((node) => node.id === editingIterationNodeId && isIteratingControlNode(node)) ?? null,
    [behaviorNodes, editingIterationNodeId]
  );

  const handleOpenSelectedIterationSettings = useCallback(() => {
    if (!selectedIterationNode) return;
    setEditingIterationNodeId(selectedIterationNode.id);
  }, [selectedIterationNode]);

  const handleSaveIterationLimit = useCallback(
    (limit: number) => {
      if (!editingIterationNode) return;
      const normalizedLimit = normalizeIterationLimit(limit);
      const nextNodes = nodes.map((node) =>
        node.id === editingIterationNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                iterationLimit: normalizedLimit,
              },
            }
          : node
      ) as BehaviorTreeNode[];

      persistEditorTree(nextNodes, edges);
      setSelectedNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === editingIterationNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  iterationLimit: normalizedLimit,
                },
              }
            : node
        )
      );
      setEditingIterationNodeId(null);
    },
    [editingIterationNode, edges, nodes, persistEditorTree]
  );

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

  useEffect(() => {
    if (selectedNodes.length === 0 && selectedEdges.length === 0) {
      setSelectionActionAnchor(null);
      return;
    }

    const canvas = reactFlowWrapper.current;
    if (!canvas) return;

    const selectedElements = Array.from(
      canvas.querySelectorAll<Element>('.react-flow__node.selected, .react-flow__edge.selected')
    );
    if (selectedElements.length === 0) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const selectionRect = selectedElements.reduce(
      (acc, element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        };
      },
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    );
    if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
      const menuWidth = Math.min(
        SELECTION_ACTIONS_MAX_WIDTH,
        Math.max(canvasRect.width - SELECTION_ACTIONS_MOBILE_MARGIN * 2, 0)
      );
      const minCenterX = SELECTION_ACTIONS_MOBILE_MARGIN + menuWidth / 2;
      const maxCenterX = Math.max(
        canvasRect.width - SELECTION_ACTIONS_MOBILE_MARGIN - menuWidth / 2,
        minCenterX
      );
      const belowSpace = canvasRect.bottom - selectionRect.bottom - SELECTION_ACTIONS_MOBILE_GAP;
      const aboveSpace = selectionRect.top - canvasRect.top - SELECTION_ACTIONS_MOBILE_GAP;
      const placement =
        belowSpace >= SELECTION_ACTIONS_MOBILE_ESTIMATED_HEIGHT || belowSpace >= aboveSpace
          ? 'below'
          : 'above';

      setSelectionActionAnchor({
        x: clamp(
          (selectionRect.left + selectionRect.right) / 2 - canvasRect.left,
          minCenterX,
          maxCenterX
        ),
        y:
          placement === 'below'
            ? selectionRect.bottom - canvasRect.top + SELECTION_ACTIONS_MOBILE_GAP
            : selectionRect.top - canvasRect.top - SELECTION_ACTIONS_MOBILE_GAP,
        placement,
      });
      return;
    }

    setSelectionActionAnchor({
      x: Math.min(
        Math.max(selectionRect.right - canvasRect.left + 10, 8),
        Math.max(canvasRect.width - SELECTION_ACTIONS_MAX_WIDTH, 8)
      ),
      y: Math.min(
        Math.max(selectionRect.top - canvasRect.top, 8),
        Math.max(canvasRect.height - 48, 8)
      ),
      placement: 'inline',
    });
  }, [edges, nodes, selectedEdges, selectedNodes]);

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
    if (!isSubtreeNode(result.subtreeNode)) return;

    const subtreeNode = result.subtreeNode;
    const nextNodes = (result.tree.nodes as BehaviorTreeNode[]).map((node) => {
      const nextNode = node.id === subtreeNode.id ? subtreeNode : node;
      return {
        ...nextNode,
        selected: nextNode.id === subtreeNode.id,
        data: {
          ...nextNode.data,
          isHighlighted: nextNode.id === subtreeNode.id,
        },
      };
    });

    persistEditorTree(nextNodes, result.tree.edges, {
      updatedAt: result.tree.updatedAt,
    });
    setSelectedEdges([]);
    selectedNodeIdsRef.current = new Set([subtreeNode.id]);
    selectedEdgeIdsRef.current = new Set();
    manualEdgeSelectionRef.current = {
      nodeIds: new Set([subtreeNode.id]),
      edgeIds: new Set(),
      expiresAt: Date.now() + MANUAL_EDGE_SELECTION_SUPPRESSION_MS,
    };
    setSelectedNodes([
      {
        ...subtreeNode,
        selected: true,
        data: {
          ...subtreeNode.data,
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
    const insertedNodeIds = new Set(result.insertedNodeIds);
    const nextNodes = (result.tree.nodes as BehaviorTreeNode[]).map((node) => ({
      ...node,
      selected: insertedNodeIds.has(node.id),
      data: {
        ...node.data,
        isHighlighted: insertedNodeIds.has(node.id),
      },
    }));

    persistEditorTree(nextNodes, result.tree.edges, {
      updatedAt: result.tree.updatedAt,
    });
    setSelectedEdges([]);
    selectedNodeIdsRef.current = insertedNodeIds;
    selectedEdgeIdsRef.current = new Set();
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
    const activeRootTree = rootTreeRef.current;
    const activePath = treePathRef.current;
    if (!activeRootTree || activePath.length === 0) return;
    const nextPath = activePath.slice(0, -1);
    const nextTree = nextPath.length === 0 ? activeRootTree : getTreeAtPath(activeRootTree, nextPath);
    if (!nextTree) return;
    syncEditorState(nextTree, nextPath, { center: true });
  }, [syncEditorState]);

  const handleSearchSelect = useCallback(
    (node: BehaviorTreeNode) => {
      const position = node.positionAbsolute ?? node.position;
      const centerX = position.x + (node.width ?? 150) / 2;
      const centerY = position.y + (node.height ?? 80) / 2;
      const selectedNode = { ...node, selected: true, dragging: false };

      setSelectedNodes([selectedNode]);
      setSelectedEdges([]);
      applySelectionState(new Set([node.id]), new Set());
      setOrderingParentId(null);
      setCenter(centerX, centerY, { zoom: Math.max(getZoom(), 1), duration: 400 });
    },
    [applySelectionState, getZoom, setCenter]
  );

  return (
    <div className={`behavior-tree-panel${isAgentOpen ? ' bt-agent-open' : ''}`} data-testid="behavior-tree-panel">
      <BehaviorTreeToolbar
        currentTree={currentTree}
        isExecuting={isExecuting}
        isPaused={isPaused}
        isEditingLocked={isExecuting}
        isPaletteCollapsed={isPaletteCollapsed}
        nodeCount={nodes.length}
        canUndo={canUndo}
        canRedo={canRedo}
        interactionMode={canvasInteractionMode}
        isFollowMode={isFollowMode}
        onSave={handleSave}
        onLoad={handleLoad}
        onNew={handleNew}
        onExecute={handleExecute}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onExport={handleExport}
        onArrange={handleArrange}
        onTogglePalette={() => setIsPaletteCollapsed((collapsed) => !collapsed)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onInteractionModeChange={setCanvasInteractionMode}
        onToggleFollowMode={() =>
          setIsFollowMode((enabled) => {
            const nextEnabled = !enabled;
            isFollowModeRef.current = nextEnabled;
            return nextEnabled;
          })
        }
        onOpenAgent={() => setIsAgentOpen(true)}
        onRename={handleRename}
        blackboardValues={isExecuting ? liveBlackboard : (currentTree?.blackboardDefaults || {})}
        onBlackboardDefaultsChange={handleBlackboardDefaultsChange}
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
          isDisabled={isExecuting}
          onToggleCollapse={() => setIsPaletteCollapsed((collapsed) => !collapsed)}
          onAddNode={handleAddNode}
        />

        <div
          className="bt-canvas"
          ref={reactFlowWrapper}
          onPointerDownCapture={handleCanvasPointerDownCapture}
          onPointerMoveCapture={handleCanvasPointerMoveCapture}
          onPointerUpCapture={handleCanvasPointerEndCapture}
          onPointerCancelCapture={handleCanvasPointerEndCapture}
          data-testid="bt-canvas"
        >
          <ReactFlow
            nodes={canvasNodes}
            edges={canvasEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodesDelete={onNodesDelete}
            onNodeClick={(event, node) => !node.id.startsWith(AGENT_PREVIEW_ID_PREFIX) && onNodeClick(event, node)}
            onNodeDoubleClick={(event, node) => !node.id.startsWith(AGENT_PREVIEW_ID_PREFIX) && onNodeDoubleClick(event, node)}
            onEdgeClick={(event, edge) => !edge.id.startsWith(AGENT_PREVIEW_ID_PREFIX) && onEdgeClick(event, edge)}
            onPaneClick={handlePaneClick}
            onSelectionChange={onSelectionChange}
            onSelectionStart={handleSelectionStart}
            onSelectionEnd={handleSelectionEnd}
            onMove={scheduleSubtreeReturnAnchorUpdate}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            selectionMode={SelectionMode.Partial}
            multiSelectionKeyCode={['Control', 'Meta']}
            nodesDraggable={!isExecuting}
            nodesConnectable={!isExecuting}
            panOnDrag={canvasInteractionMode === 'pan'}
            selectionOnDrag={false}
            connectionRadius={48}
            fitView
            minZoom={0.1}
            maxZoom={2}
            deleteKeyCode={isExecuting ? null : ['Backspace', 'Delete']}
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
          {customBoxSelection && (
            <div
              className="bt-custom-selection"
              style={{
                left: customBoxSelection.left,
                top: customBoxSelection.top,
                width: customBoxSelection.width,
                height: customBoxSelection.height,
              }}
              data-testid="bt-custom-selection"
            />
          )}
          <NodeSearch nodes={behaviorNodes} onSelectNode={handleSearchSelect} />
          {treePath.length > 0 && subtreeReturnAnchor && (
            <button
              type="button"
              className="bt-subtree-parent-action"
              style={{ left: subtreeReturnAnchor.x, top: subtreeReturnAnchor.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleNavigateUp();
              }}
              title="Back to parent tree"
              aria-label="Back to parent tree"
              data-testid="bt-subtree-parent"
            >
              <FaLevelUpAlt aria-hidden="true" />
              <span>Parent</span>
            </button>
          )}
          {!isExecuting &&
            selectionActionAnchor &&
            (selectedNodes.length > 0 || selectedEdges.length > 0) && (
            <div
              className={`bt-selection-actions placement-${selectionActionAnchor.placement}`}
              style={{
                left: selectionActionAnchor.x,
                top: selectionActionAnchor.y,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              data-testid="bt-selection-actions"
            >
              {selectedNodes.length === 1 && (
                <button
                  type="button"
                  className="bt-selection-action"
                  onClick={handleOpenSelectedNodeRename}
                  title="Rename selected node"
                  aria-label="Rename selected node"
                  data-testid="bt-rename-selected"
                >
                  <FaEdit aria-hidden="true" />
                  <span>Rename</span>
                </button>
              )}
              {selectedIterationNode && (
                <button
                  type="button"
                  className="bt-selection-action"
                  onClick={handleOpenSelectedIterationSettings}
                  title="Set retry/repeat count"
                  aria-label="Set retry/repeat count"
                  data-testid="bt-configure-iteration"
                >
                  <FaCog aria-hidden="true" />
                  <span>Count</span>
                </button>
              )}
              {selectedNodes.length > 0 && (
                <button
                  type="button"
                  className="bt-selection-action"
                  onClick={handleDuplicateSelected}
                  title={`Duplicate ${selectedNodes.length} selected node${selectedNodes.length > 1 ? 's' : ''}`}
                  aria-label="Duplicate selected nodes"
                  data-testid="bt-duplicate-selected"
                >
                  <FaClone aria-hidden="true" />
                  <span>Duplicate</span>
                </button>
              )}
              {canWrapSelection && (
                <button
                  type="button"
                  className="bt-selection-action"
                  onClick={handleWrapSelectedIntoSubtree}
                  title="Wrap selected nodes in a subtree"
                  aria-label="Wrap selected nodes in a subtree"
                  data-testid="bt-context-wrap"
                >
                  <FaObjectGroup aria-hidden="true" />
                  <span>Wrap</span>
                </button>
              )}
              {selectedSubtreeNode && (
                <>
                  <button
                    type="button"
                    className="bt-selection-action"
                    onClick={handleOpenSelectedSubtree}
                    title="Open selected subtree"
                    aria-label="Open selected subtree"
                    data-testid="bt-context-open-subtree"
                  >
                    <FaFolderOpen aria-hidden="true" />
                    <span>Open</span>
                  </button>
                  <button
                    type="button"
                    className="bt-selection-action"
                    onClick={handleSaveSelectedSubtree}
                    title="Save selected subtree as a saved tree"
                    aria-label="Save selected subtree"
                    data-testid="bt-context-save-subtree"
                  >
                    <FaSave aria-hidden="true" />
                    <span>Save</span>
                  </button>
                  <button
                    type="button"
                    className="bt-selection-action"
                    onClick={handleExplodeSelectedSubtree}
                    title="Explode selected subtree"
                    aria-label="Explode selected subtree"
                    data-testid="bt-context-explode"
                  >
                    <FaExpandArrowsAlt aria-hidden="true" />
                    <span>Explode</span>
                  </button>
                </>
              )}
              {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
                <button
                  type="button"
                  className="bt-selection-action danger"
                  onClick={handleDeleteSelected}
                  title={`Delete selected item${selectedNodes.length + selectedEdges.length > 1 ? 's' : ''}`}
                  aria-label="Delete selected items"
                >
                  <FaTrash aria-hidden="true" />
                  <span>Delete</span>
                </button>
              )}
            </div>
          )}
          {orderingParent && (
            <ChildOrderPanel
              parent={orderingParent}
              childLinks={selectedOrderedChildLinks}
              onMoveChild={handleMoveOrderedChild}
              onClose={() => setOrderingParentId(null)}
            />
          )}
          {agentPreviewTree && agentPreviewSummary && (
            <div className="bt-agent-canvas-preview-banner" data-testid="bt-agent-canvas-preview-banner">
              <span className="pulse" aria-hidden="true" />
              <strong>Agent preview</strong>
              <span className="added">+{agentPreviewSummary.added}</span>
              <span className="changed">~{agentPreviewSummary.changed}</span>
              <span className="removed">−{agentPreviewSummary.removed}</span>
              <div className="bt-agent-canvas-preview-actions">
                <button type="button" className="fit" onClick={fitAgentPreviewInView}>Fit</button>
                <button
                  type="button"
                  className="reject"
                  onClick={clearAgentPreview}
                >Reject</button>
                <button
                  type="button"
                  className="subtree"
                  onClick={() => applyAgentPreview('subtree')}
                >Add subtree</button>
                <button
                  type="button"
                  className="accept"
                  onClick={() => applyAgentPreview('replace')}
                >Replace</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <BehaviorTreeAgentPanel
        open={isAgentOpen}
        ros={ros}
        isConnected={isConnected}
        currentTree={currentTree}
        selectedTreeContext={selectedTreeContext}
        previewTree={agentPreviewTree}
        onClose={() => {
          setIsAgentOpen(false);
          clearAgentPreview();
        }}
        onPreviewChange={tree => {
          setAgentPreviewTree(tree);
          setAgentPreviewDimensions({});
          if (tree) {
            fitAgentPreviewInView();
          }
        }}
      />

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
      {editingIterationNode && (
        <IterationLimitEditor
          node={editingIterationNode}
          onSave={handleSaveIterationLimit}
          onClose={() => setEditingIterationNodeId(null)}
        />
      )}
      {editingConfigNode && (
        <BehaviorNodeConfigEditor
          node={editingConfigNode}
          blackboardVariables={Object.keys(currentTree?.blackboardDefaults || {})}
          onSave={handleSaveNodeConfig}
          onClose={() => setEditingConfigNodeId(null)}
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
