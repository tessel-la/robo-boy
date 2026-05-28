import React, { useState, useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Connection,
  Edge,
  Node,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  BackgroundVariant,
  ConnectionMode,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Ros } from 'roslib';
import { v4 as uuidv4 } from 'uuid';

import { nodeTypes } from './nodes/nodeTypes';
import NodePalette from './NodePalette';
import BehaviorTreeToolbar from './BehaviorTreeToolbar';
import ActionParameterEditor from './ActionParameterEditor';
import ServiceParameterEditor from './ServiceParameterEditor';
import { BehaviorTreeExecutor } from '../engine/executor';
import { saveBehaviorTree, exportBehaviorTree } from '../storage/treeStorage';
import {
  createBehaviorTreeNode,
  duplicateSelectedBehaviorNodes,
  getNextBehaviorNodeId,
  getNodeCounterAfterNodes,
  ROSNodeInfo,
} from '../nodeUtils';
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
import './BehaviorTreePanel.css';

interface BehaviorTreePanelProps {
  ros: Ros | null;
  isConnected: boolean;
  isActive: boolean;
}

interface SaveNotice {
  id: number;
  type: 'success' | 'error';
  title: string;
  message: string;
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';

const BehaviorTreePanelInner: React.FC<BehaviorTreePanelProps> = ({
  ros,
  isConnected,
  isActive,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [currentTree, setCurrentTree] = useState<BehaviorTree | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(
    () => window.matchMedia(MOBILE_BREAKPOINT).matches
  );
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([]);
  // Action node currently being edited via the parameter editor modal.
  const [editingAction, setEditingAction] = useState<
    { nodeId: string; data: ROSActionNodeData } | null
  >(null);
  const [editingService, setEditingService] = useState<
    { nodeId: string; data: ROSServiceNodeData } | null
  >(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const executorRef = useRef<BehaviorTreeExecutor | null>(null);
  const nodeIdCounter = useRef(0);
  const saveNoticeTimer = useRef<number | null>(null);

  const { screenToFlowPosition, deleteElements } = useReactFlow();

  const allocateNodeId = useCallback((existingNodes: Node[]) => {
    const id = getNextBehaviorNodeId(existingNodes, nodeIdCounter.current);
    nodeIdCounter.current = getNodeCounterAfterNodes([{ id }], nodeIdCounter.current);
    return id;
  }, []);

  const addNodeAtPosition = useCallback(
    (nodeType: BehaviorNodeType, position: { x: number; y: number }, rosInfo?: ROSNodeInfo) => {
      setNodes((currentNodes) => {
        const id = allocateNodeId(currentNodes);
        const newNode = createBehaviorTreeNode({ id, nodeType, position, rosInfo });
        return newNode ? currentNodes.concat(newNode) : currentNodes;
      });
    },
    [allocateNodeId, setNodes]
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
    if (!currentTree) {
      const newTree: BehaviorTree = {
        id: uuidv4(),
        name: 'Untitled Behavior Tree',
        nodes: [],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setCurrentTree(newTree);
    }
  }, [currentTree]);

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
      setEdges((eds) => addEdge(normalizeEdge(connection), eds));
    },
    [setEdges]
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

      let data: { nodeType?: BehaviorNodeType; rosInfo?: ROSNodeInfo };
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

      addNodeAtPosition(data.nodeType, position, data.rosInfo);
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
    deleteElements({ nodes: selectedNodes });
    setSelectedNodes([]);
  }, [deleteElements, selectedNodes]);

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
    setNodes(result.nodes);
    setEdges(result.edges);
    setSelectedNodes(result.duplicatedNodes);
  }, [edges, nodes, selectedNodes, setEdges, setNodes]);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === BehaviorNodeType.Action) {
        setEditingAction({ nodeId: node.id, data: node.data as ROSActionNodeData });
      } else if (node.type === BehaviorNodeType.Service) {
        setEditingService({ nodeId: node.id, data: node.data as ROSServiceNodeData });
      }
    },
    []
  );

  const handleSaveActionParameters = useCallback(
    (parameters: Record<string, any>) => {
      if (!editingAction) return;
      const { nodeId } = editingAction;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, parameters } };
        })
      );
    },
    [editingAction, setNodes]
  );

  const handleSaveServiceRequest = useCallback(
    (request: Record<string, any>) => {
      if (!editingService) return;
      const { nodeId } = editingService;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, request } };
        })
      );
    },
    [editingService, setNodes]
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
      setCurrentTree(updatedTree);
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
  }, [currentTree, nodes, edges, showSaveNotice]);

  const handleLoad = useCallback((tree: BehaviorTree) => {
    const loadedNodes = tree.nodes.map((node) => ({
      ...node,
      selected: false,
      dragging: false,
    }));
    // Strip legacy sourceHandle values (out-1, out-2, out-3) from saved trees.
    const loadedEdges = tree.edges.map((e) => ({
      ...e,
      sourceHandle: null,
      targetHandle: null,
      selected: false,
    }));
    setCurrentTree({ ...tree, nodes: loadedNodes, edges: loadedEdges });
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSelectedNodes([]);
    nodeIdCounter.current = getNodeCounterAfterNodes(loadedNodes);
  }, [setNodes, setEdges]);

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
    setCurrentTree(newTree);
    setNodes([]);
    setEdges([]);
    nodeIdCounter.current = 0;
  }, [nodes, edges, setNodes, setEdges]);

  const handleExport = useCallback(() => {
    if (!currentTree) return;
    exportBehaviorTree({ ...currentTree, nodes: nodes as BehaviorTreeNode[], edges });
  }, [currentTree, nodes, edges]);

  const handleRename = useCallback((name: string) => {
    setCurrentTree((prev) => (prev ? { ...prev, name } : null));
  }, []);

  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      if (event.nodeId && event.data?.status) {
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === event.nodeId) {
              return { ...node, data: { ...node.data, status: event.data.status } };
            }
            return node;
          })
        );
      }
      if (event.type === 'completed' || event.type === 'stopped') {
        setIsExecuting(false);
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((node) => ({
              ...node,
              data: { ...node.data, status: ExecutionStatus.Idle },
            }))
          );
        }, 2000);
      }
    },
    [setNodes]
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
    executorRef.current = new BehaviorTreeExecutor(treeToExecute, ros, handleExecutionEvent);
    setIsExecuting(true);
    executorRef.current.start();
  }, [ros, isConnected, currentTree, nodes, edges, handleExecutionEvent]);

  const handleStop = useCallback(() => {
    if (executorRef.current) executorRef.current.stop();
    setIsExecuting(false);
  }, []);

  // Stop executor when user navigates away so it doesn't block gamepad control
  useEffect(() => {
    if (!isActive && isExecuting) {
      handleStop();
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a node at the centre of the visible canvas — used for mobile tap-to-add.
  const handleAddNode = useCallback(
    (nodeType: BehaviorNodeType, rosInfo?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo) => {
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });

      addNodeAtPosition(nodeType, position, rosInfo);

      // Close palette on mobile after adding
      if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
        setIsPaletteCollapsed(true);
      }
    },
    [addNodeAtPosition, screenToFlowPosition]
  );

  return (
    <div className="behavior-tree-panel" data-testid="behavior-tree-panel">
      <BehaviorTreeToolbar
        currentTree={currentTree}
        isExecuting={isExecuting}
        isPaletteCollapsed={isPaletteCollapsed}
        selectedNodeCount={selectedNodes.length}
        onSave={handleSave}
        onLoad={handleLoad}
        onNew={handleNew}
        onExecute={handleExecute}
        onStop={handleStop}
        onExport={handleExport}
        onTogglePalette={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
        onDeleteSelected={handleDeleteSelected}
        onDuplicateSelected={handleDuplicateSelected}
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
          onToggleCollapse={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
          onAddNode={handleAddNode}
        />

        <div className="bt-canvas" ref={reactFlowWrapper} data-testid="bt-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodesDelete={onNodesDelete}
            onNodeDoubleClick={onNodeDoubleClick}
            onSelectionChange={onSelectionChange}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
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
    </div>
  );
};

const BehaviorTreePanel: React.FC<BehaviorTreePanelProps> = (props) => (
  <ReactFlowProvider>
    <BehaviorTreePanelInner {...props} />
  </ReactFlowProvider>
);

export default BehaviorTreePanel;
