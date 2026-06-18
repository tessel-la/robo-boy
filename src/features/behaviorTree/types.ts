import { Node, Edge } from 'reactflow';

// Execution status for behavior tree nodes
export enum ExecutionStatus {
  Idle = 'idle',
  Running = 'running',
  Success = 'success',
  Failure = 'failure',
}

// Base node types
export enum BehaviorNodeType {
  // Control flow nodes
  Sequence = 'sequence',
  Selector = 'selector',
  Parallel = 'parallel',
  Subtree = 'subtree',
  
  // ROS nodes
  Action = 'action',
  Service = 'service',
  Topic = 'topic',
  
  // Utility nodes
  Condition = 'condition',
}

// ROS discovery results
export interface ROSActionInfo {
  name: string;
  type: string;
  namespace: string;
}

export interface ROSServiceInfo {
  name: string;
  type: string;
}

export interface ROSTopicInfo {
  name: string;
  type: string;
}

export interface ROSDiscoveryResult {
  actions: ROSActionInfo[];
  services: ROSServiceInfo[];
  topics: ROSTopicInfo[];
}

// Node data interfaces
export interface BaseNodeData {
  label: string;
  status?: ExecutionStatus;
  isHighlighted?: boolean;
}

export interface ROSActionNodeData extends BaseNodeData {
  actionName: string;
  actionType: string;
  parameters?: Record<string, any>;
  timeout?: number;
}

export interface ROSServiceNodeData extends BaseNodeData {
  serviceName: string;
  serviceType: string;
  request?: Record<string, any>;
  timeout?: number;
}

export interface ROSTopicNodeData extends BaseNodeData {
  topicName: string;
  messageType: string;
  message?: Record<string, any>;
  publishOnce?: boolean;
}

export interface ControlFlowNodeData extends BaseNodeData {
  type: 'sequence' | 'selector' | 'parallel';
  description?: string;
}

export interface SubtreeNodeData extends BaseNodeData {
  tree: BehaviorTree;
  sourceTreeId?: string;
}

export interface ConditionNodeData extends BaseNodeData {
  condition: string;
  expectedValue?: any;
  operator?: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'exists';
}

// Union type for all node data types
export type BehaviorNodeData =
  | ROSActionNodeData
  | ROSServiceNodeData
  | ROSTopicNodeData
  | ControlFlowNodeData
  | SubtreeNodeData
  | ConditionNodeData;

// Behavior tree node (extends React Flow Node)
export type BehaviorTreeNode = Node<BehaviorNodeData>;

// Complete behavior tree structure
export interface BehaviorTree {
  id: string;
  name: string;
  description?: string;
  nodes: BehaviorTreeNode[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}

// Execution context
export interface ExecutionContext {
  treeId: string;
  nodeStatuses: Map<string, ExecutionStatus>;
  currentNodeId: string | null;
  isRunning: boolean;
  startTime?: number;
  endTime?: number;
}

// Event types for execution engine
export type ExecutionEventType = 
  | 'started'
  | 'nodeEntered'
  | 'nodeSuccess'
  | 'nodeFailure'
  | 'nodeRunning'
  | 'completed'
  | 'stopped'
  | 'error';

export interface ExecutionEvent {
  type: ExecutionEventType;
  nodeId?: string;
  timestamp: number;
  data?: {
    status?: ExecutionStatus;
    treePath?: string[];
    [key: string]: unknown;
  };
  error?: string;
}

// Execution callback type
export type ExecutionCallback = (event: ExecutionEvent) => void;

// Storage interface for saved trees
export interface SavedBehaviorTree {
  tree: BehaviorTree;
  version: string;
}

// Node palette item
export interface NodePaletteItem {
  type: BehaviorNodeType;
  label: string;
  icon?: string;
  category: 'control' | 'ros' | 'utility';
  rosInfo?: ROSActionInfo | ROSServiceInfo | ROSTopicInfo;
}
