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
import { BehaviorTreeExecutor } from '../engine/executor';
import { saveBehaviorTree, exportBehaviorTree } from '../storage/treeStorage';
import {
  BehaviorTree,
  BehaviorTreeNode,
  BehaviorNodeType,
  ROSActionNodeData,
  ROSServiceNodeData,
  ROSTopicNodeData,
  ControlFlowNodeData,
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
}

const MOBILE_BREAKPOINT = '(max-width: 768px)';

const BehaviorTreePanelInner: React.FC<BehaviorTreePanelProps> = ({
  ros,
  isConnected,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [currentTree, setCurrentTree] = useState<BehaviorTree | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaletteCollapsed, setIsPaletteCollapsed] = useState(
    () => window.matchMedia(MOBILE_BREAKPOINT).matches
  );
  // Action node currently being edited via the parameter editor modal.
  // Holds the node id + a snapshot of the action data so the editor stays
  // stable even if React Flow re-renders the node.
  const [editingAction, setEditingAction] = useState<
    { nodeId: string; data: ROSActionNodeData } | null
  >(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const executorRef = useRef<BehaviorTreeExecutor | null>(null);
  const nodeIdCounter = useRef(0);

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

  // Handle connections between nodes
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges]
  );

  // Handle drag over (for node drop)
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  // Handle node drop from palette
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const dataStr = event.dataTransfer.getData('application/reactflow');
      if (!dataStr) return;

      const data = JSON.parse(dataStr);
      const { nodeType, rosInfo } = data;

      // Calculate position
      const position = {
        x: event.clientX - reactFlowBounds.left - 75,
        y: event.clientY - reactFlowBounds.top - 40,
      };

      // Generate unique node ID
      const id = `node-${nodeIdCounter.current++}`;

      // Create node data based on type
      let nodeData: any;
      let label = '';

      switch (nodeType) {
        case BehaviorNodeType.Sequence:
          label = 'Sequence';
          nodeData = { label, type: 'sequence' } as ControlFlowNodeData;
          break;
        case BehaviorNodeType.Selector:
          label = 'Selector';
          nodeData = { label, type: 'selector' } as ControlFlowNodeData;
          break;
        case BehaviorNodeType.Parallel:
          label = 'Parallel';
          nodeData = { label, type: 'parallel' } as ControlFlowNodeData;
          break;
        case BehaviorNodeType.Action:
          label = rosInfo?.name || 'Action';
          nodeData = {
            label,
            actionName: rosInfo?.name || '',
            actionType: rosInfo?.type || '',
          } as ROSActionNodeData;
          break;
        case BehaviorNodeType.Service:
          label = rosInfo?.name || 'Service';
          nodeData = {
            label,
            serviceName: rosInfo?.name || '',
            serviceType: rosInfo?.type || '',
          } as ROSServiceNodeData;
          break;
        case BehaviorNodeType.Topic:
          label = rosInfo?.name || 'Topic';
          nodeData = {
            label,
            topicName: rosInfo?.name || '',
            messageType: rosInfo?.type || '',
          } as ROSTopicNodeData;
          break;
        default:
          return;
      }

      const newNode: Node = {
        id,
        type: nodeType,
        position,
        data: nodeData,
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  // Handle node deletion
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      console.log('Nodes deleted:', deleted);
    },
    []
  );

  // Open the parameter editor when an action node is double-clicked.
  // Other node types are ignored — they don't carry user-editable parameters
  // (yet).
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type !== BehaviorNodeType.Action) return;
      setEditingAction({
        nodeId: node.id,
        data: node.data as ROSActionNodeData,
      });
    },
    []
  );

  // Save edited action parameters back into the React Flow node so they're
  // included the next time the executor reads the tree.
  const handleSaveActionParameters = useCallback(
    (parameters: Record<string, any>) => {
      if (!editingAction) return;
      const { nodeId } = editingAction;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              parameters,
            },
          };
        })
      );
    },
    [editingAction, setNodes]
  );

  // Save current tree
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
      alert(`Tree "${updatedTree.name}" saved successfully!`);
    } else {
      alert('Failed to save tree');
    }
  }, [currentTree, nodes, edges]);

  // Load a tree
  const handleLoad = useCallback((tree: BehaviorTree) => {
    setCurrentTree(tree);
    setNodes(tree.nodes);
    setEdges(tree.edges);
  }, [setNodes, setEdges]);

  // Create new tree
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

  // Export tree
  const handleExport = useCallback(() => {
    if (!currentTree) return;

    const treeToExport: BehaviorTree = {
      ...currentTree,
      nodes: nodes as BehaviorTreeNode[],
      edges,
    };

    exportBehaviorTree(treeToExport);
  }, [currentTree, nodes, edges]);

  // Execution callbacks
  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      console.log('Execution event:', event);

      if (event.nodeId && event.data?.status) {
        // Update node status in UI
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === event.nodeId) {
              return {
                ...node,
                data: {
                  ...node.data,
                  status: event.data.status,
                },
              };
            }
            return node;
          })
        );
      }

      if (event.type === 'completed' || event.type === 'stopped') {
        setIsExecuting(false);
        // Reset all node statuses after a delay
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((node) => ({
              ...node,
              data: {
                ...node.data,
                status: ExecutionStatus.Idle,
              },
            }))
          );
        }, 2000);
      }
    },
    [setNodes]
  );

  // Execute tree
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

    executorRef.current = new BehaviorTreeExecutor(
      treeToExecute,
      ros,
      handleExecutionEvent
    );

    setIsExecuting(true);
    executorRef.current.start();
  }, [ros, isConnected, currentTree, nodes, edges, handleExecutionEvent]);

  // Stop execution
  const handleStop = useCallback(() => {
    if (executorRef.current) {
      executorRef.current.stop();
    }
    setIsExecuting(false);
  }, []);

  const { screenToFlowPosition } = useReactFlow();

  // Add a node at the centre of the visible canvas — used for mobile tap-to-add.
  const handleAddNode = useCallback(
    (nodeType: BehaviorNodeType, rosInfo?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo) => {
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });

      const id = `node-${nodeIdCounter.current++}`;
      let nodeData: ControlFlowNodeData | ROSActionNodeData | ROSServiceNodeData | ROSTopicNodeData;
      let label = '';

      switch (nodeType) {
        case BehaviorNodeType.Sequence:
          label = 'Sequence';
          nodeData = { label, type: 'sequence' };
          break;
        case BehaviorNodeType.Selector:
          label = 'Selector';
          nodeData = { label, type: 'selector' };
          break;
        case BehaviorNodeType.Parallel:
          label = 'Parallel';
          nodeData = { label, type: 'parallel' };
          break;
        case BehaviorNodeType.Action:
          label = rosInfo?.name || 'Action';
          nodeData = {
            label,
            actionName: rosInfo?.name || '',
            actionType: rosInfo?.type || '',
          };
          break;
        case BehaviorNodeType.Service:
          label = rosInfo?.name || 'Service';
          nodeData = {
            label,
            serviceName: rosInfo?.name || '',
            serviceType: rosInfo?.type || '',
          };
          break;
        case BehaviorNodeType.Topic:
          label = rosInfo?.name || 'Topic';
          nodeData = {
            label,
            topicName: rosInfo?.name || '',
            messageType: rosInfo?.type || '',
          };
          break;
        default:
          return;
      }

      const newNode: Node = { id, type: nodeType, position, data: nodeData };
      setNodes((nds) => nds.concat(newNode));

      // Close palette on mobile after adding
      if (window.matchMedia(MOBILE_BREAKPOINT).matches) {
        setIsPaletteCollapsed(true);
      }
    },
    [screenToFlowPosition, setNodes]
  );

  return (
    <div className="behavior-tree-panel">
      <BehaviorTreeToolbar
        currentTree={currentTree}
        isExecuting={isExecuting}
        onSave={handleSave}
        onLoad={handleLoad}
        onNew={handleNew}
        onExecute={handleExecute}
        onStop={handleStop}
        onExport={handleExport}
      />

      <div className="bt-content">
        <NodePalette
          ros={ros}
          isConnected={isConnected}
          isCollapsed={isPaletteCollapsed}
          onToggleCollapse={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
          onAddNode={handleAddNode}
        />

        <div className="bt-canvas" ref={reactFlowWrapper}>
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
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            fitView
            minZoom={0.1}
            maxZoom={2}
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

          {/* Mobile-only palette toggle — hidden on desktop via CSS */}
          <button
            className="bt-palette-fab"
            onClick={() => setIsPaletteCollapsed(!isPaletteCollapsed)}
            title={isPaletteCollapsed ? 'Open Node Palette' : 'Close Node Palette'}
          >
            {isPaletteCollapsed ? '＋' : '✕'}
          </button>
        </div>
      </div>

      {editingAction && (
        <ActionParameterEditor
          nodeData={editingAction.data}
          onSave={handleSaveActionParameters}
          onClose={() => setEditingAction(null)}
        />
      )}
    </div>
  );
};

// Wrap with ReactFlowProvider
const BehaviorTreePanel: React.FC<BehaviorTreePanelProps> = (props) => (
  <ReactFlowProvider>
    <BehaviorTreePanelInner {...props} />
  </ReactFlowProvider>
);

export default BehaviorTreePanel;

