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
  Retry = 'retry',
  Repeat = 'repeat',
  Timeout = 'timeout',
  IfElse = 'ifElse',
  Subtree = 'subtree',
  
  // ROS nodes
  Action = 'action',
  Service = 'service',
  Topic = 'topic',
  Subscriber = 'subscriber',
  
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

export type BlackboardValue = unknown;

export interface BlackboardInputBinding {
  variable: string;
  targetPath: string;
}

export interface BlackboardOutputBinding {
  sourcePath: string;
  variable: string;
}

export interface ROSActionNodeData extends BaseNodeData {
  actionName: string;
  actionType: string;
  parameters?: Record<string, any>;
  timeout?: number;
  inputBindings?: BlackboardInputBinding[];
  outputBindings?: BlackboardOutputBinding[];
}

export interface ROSServiceNodeData extends BaseNodeData {
  serviceName: string;
  serviceType: string;
  request?: Record<string, any>;
  timeout?: number;
  inputBindings?: BlackboardInputBinding[];
  outputBindings?: BlackboardOutputBinding[];
}

export interface ROSTopicNodeData extends BaseNodeData {
  topicName: string;
  messageType: string;
  message?: Record<string, any>;
  publishOnce?: boolean;
  frequencyHz?: number;
  durationMs?: number;
  inputBindings?: BlackboardInputBinding[];
}

export interface ROSSubscriberNodeData extends BaseNodeData {
  topicName: string;
  messageType: string;
  timeout?: number;
  outputBindings: BlackboardOutputBinding[];
}

export interface ControlFlowNodeData extends BaseNodeData {
  type: 'sequence' | 'selector' | 'parallel' | 'retry' | 'repeat';
  description?: string;
  generatedBySubtreeWrap?: boolean;
  iterationLimit?: number;
}

export interface TimeoutNodeData extends BaseNodeData {
  timeout: number;
}

export type BlackboardComparisonOperator =
  | 'truthy'
  | 'falsy'
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'exists';

export interface IfElseNodeData extends BaseNodeData {
  variable: string;
  operator: BlackboardComparisonOperator;
  expectedValue?: BlackboardValue;
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
  | ROSSubscriberNodeData
  | ControlFlowNodeData
  | TimeoutNodeData
  | IfElseNodeData
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
  blackboardDefaults?: Record<string, BlackboardValue>;
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
  | 'paused'
  | 'resumed'
  | 'nodeEntered'
  | 'nodeSuccess'
  | 'nodeFailure'
  | 'nodeRunning'
  | 'blackboardUpdated'
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
