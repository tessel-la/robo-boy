import { Node, Edge } from 'reactflow';

// Execution status for behavior tree nodes
export enum ExecutionStatus {
  Idle = 'idle',
  Running = 'running',
  Success = 'success',
  Failure = 'failure',
}

export enum BehaviorTreeEngine {
  Local = 'local',
  PyTrees = 'py_trees',
  BehaviorTreeCpp = 'behavior_tree_cpp',
}

export interface BehaviorTreeEngineConfig {
  engine: BehaviorTreeEngine;
  namespace: string;
  capabilitiesTopic: string;
  treeCatalogTopic: string;
  catalogTopic: string;
  specTopic: string;
  commandTopic: string;
  statusTopic: string;
  treeTopic: string;
  selectedRuntimeNodeId?: string;
}

export interface BehaviorTreeNodeParamInfo {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required?: boolean;
  default?: any;
  description?: string;
}

export interface BehaviorTreeNodeTypeInfo {
  id: string;
  label: string;
  category: 'control' | 'action' | 'condition' | 'decorator' | 'utility';
  description?: string;
  params?: BehaviorTreeNodeParamInfo[];
  minChildren?: number;
  maxChildren?: number;
}

export interface BehaviorTreeRuntimeTreeInfo {
  id: string;
  name: string;
  engine?: BehaviorTreeEngine | string;
  format?: 'yaml' | 'xml' | 'json';
  spec?: string;
  description?: string;
}

export interface BehaviorTreeEngineCapabilities {
  engine: BehaviorTreeEngine | string;
  nodeTypes: BehaviorTreeNodeTypeInfo[];
  trees?: BehaviorTreeRuntimeTreeInfo[];
  constraints?: string[];
}

export interface BehaviorTreeRuntimeNode {
  id: string;
  name: string;
  type?: string;
  status?: ExecutionStatus;
  treeId?: string;
  path?: string;
  parentId?: string;
  source?: string;
  raw?: Record<string, any>;
}

// Base node types
export enum BehaviorNodeType {
  // Control flow nodes
  Sequence = 'sequence',
  Selector = 'selector',
  Parallel = 'parallel',
  
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
  externalKind?: string;
  externalParams?: Record<string, any>;
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
  | ConditionNodeData;

// Behavior tree node (extends React Flow Node)
export type BehaviorTreeNode = Node<BehaviorNodeData>;

// Complete behavior tree structure
export interface BehaviorTree {
  id: string;
  name: string;
  description?: string;
  engine?: BehaviorTreeEngine;
  engineConfig?: Partial<BehaviorTreeEngineConfig>;
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
  data?: any;
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
