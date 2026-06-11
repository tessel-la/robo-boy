import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
import ROSLIB from 'roslib';
import { v4 as uuidv4 } from 'uuid';
import { FaArrowDown, FaArrowUp } from 'react-icons/fa';

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
  annotateOrderedEdges,
  getOrderedChildLinks,
  isOrderedControlNode,
  moveOrderedChildEdge,
  OrderedChildLink,
} from '../orderUtils';
import {
  BehaviorTree,
  BehaviorTreeEngine,
  BehaviorTreeEngineCapabilities,
  BehaviorTreeEngineConfig,
  BehaviorTreeNode,
  BehaviorTreeNodeTypeInfo,
  BehaviorTreeRuntimeTreeInfo,
  BehaviorTreeRuntimeNode,
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
  DEFAULT_ENGINE_CONFIGS,
  DEFAULT_NODE_TYPES,
  behaviorNodeTypeFromEngineType,
  createNodeDataFromEngineType,
  downloadTextFile,
  exportTreeAsBtCppXml,
  exportTreeAsYaml,
  getEngineConfig,
  importTreeFromText,
  parseEngineCapabilitiesMessage,
  parseRuntimeNodeCatalogMessage,
  parseRuntimeTreeCatalogMessage,
  parseRuntimeStatusMessage,
  validateBehaviorTreeForEngine,
} from '../engineIntegration';
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

interface EnginePanelProps {
  config: BehaviorTreeEngineConfig;
  isConnected: boolean;
  liveStatus: string;
  runtimeNodes: BehaviorTreeRuntimeNode[];
  constraints: string[];
  validationErrors: string[];
  selectedRuntimeNodeId?: string;
  embedded?: boolean;
  onConfigChange: (config: BehaviorTreeEngineConfig) => void;
  onSelectRuntimeNode: (node: BehaviorTreeRuntimeNode) => void;
  onExportYaml: () => void;
  onExportXml: () => void;
  onPublishSpec: () => void;
  onRunExternal: () => void;
  onStopExternal: () => void;
}

const ENGINE_LABELS: Record<BehaviorTreeEngine, string> = {
  [BehaviorTreeEngine.Local]: 'Local',
  [BehaviorTreeEngine.PyTrees]: 'py_trees',
  [BehaviorTreeEngine.BehaviorTreeCpp]: 'BT.CPP',
};

const runtimeTopic = (namespace: string, suffix: string): string => {
  const normalized = namespace.trim().replace(/^\/+|\/+$/g, '');
  return `/${[normalized, 'behavior_tree/runtime', suffix].filter(Boolean).join('/')}`;
};

const runtimeTopicConfig = (namespace: string): Pick<
  BehaviorTreeEngineConfig,
  | 'capabilitiesTopic'
  | 'treeCatalogTopic'
  | 'catalogTopic'
  | 'specTopic'
  | 'commandTopic'
  | 'statusTopic'
  | 'treeTopic'
> => ({
  capabilitiesTopic: runtimeTopic(namespace, 'capabilities'),
  treeCatalogTopic: runtimeTopic(namespace, 'trees'),
  catalogTopic: runtimeTopic(namespace, 'nodes'),
  specTopic: runtimeTopic(namespace, 'spec'),
  commandTopic: runtimeTopic(namespace, 'command'),
  statusTopic: runtimeTopic(namespace, 'status'),
  treeTopic: runtimeTopic(namespace, 'tree'),
});

const runtimeNamespaceFromTopic = (topic: string): string | null => {
  const match = topic.match(/^\/(.+)\/behavior_tree\/runtime\/capabilities$/);
  return match?.[1] ?? null;
};

const runtimeNodeLookupKeys = (node: BehaviorTreeRuntimeNode): string[] => {
  const pathTail = node.path?.split('/').filter(Boolean).pop();
  return [
    node.id,
    node.path,
    pathTail,
    node.name,
    node.treeId && node.name ? `${node.treeId}/${node.name}` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
};

const runtimeNodeStatusFromMap = (
  node: BehaviorTreeRuntimeNode,
  statuses: Map<string, ExecutionStatus>
): ExecutionStatus | undefined => {
  const normalizedStatuses = new Map(
    Array.from(statuses.entries()).map(([key, status]) => [key.toLowerCase(), status])
  );
  return runtimeNodeLookupKeys(node)
    .map((key) => normalizedStatuses.get(key))
    .find((status): status is ExecutionStatus => Boolean(status));
};

const EngineIntegrationPanel: React.FC<EnginePanelProps> = ({
  config,
  isConnected,
  liveStatus,
  runtimeNodes,
  constraints,
  validationErrors,
  selectedRuntimeNodeId,
  embedded = false,
  onConfigChange,
  onSelectRuntimeNode,
  onExportYaml,
  onExportXml,
  onPublishSpec,
  onRunExternal,
  onStopExternal,
}) => {
  const updateConfig = (patch: Partial<BehaviorTreeEngineConfig>) => {
    const nextEngine = patch.engine ?? config.engine;
    const engineChanged = patch.engine !== undefined && patch.engine !== config.engine;
    const baseConfig = engineChanged ? DEFAULT_ENGINE_CONFIGS[nextEngine] : config;
    const nextConfig: BehaviorTreeEngineConfig = {
      ...baseConfig,
      ...patch,
      engine: nextEngine,
    };

    if (patch.namespace !== undefined && nextEngine !== BehaviorTreeEngine.Local) {
      Object.assign(nextConfig, runtimeTopicConfig(patch.namespace));
    }

    onConfigChange(nextConfig);
  };

  return (
    <div className={`bt-engine-panel${embedded ? ' embedded' : ''}`} data-testid="bt-engine-panel">
      <div className="bt-engine-row">
        <div className="bt-engine-switch" role="radiogroup" aria-label="Behavior tree engine">
          {Object.values(BehaviorTreeEngine).map((engine) => (
            <button
              key={engine}
              type="button"
              className={`bt-engine-switch-option${config.engine === engine ? ' active' : ''}`}
              role="radio"
              aria-checked={config.engine === engine}
              aria-label={`Use ${ENGINE_LABELS[engine]} engine`}
              onClick={() => updateConfig({ engine })}
            >
              {ENGINE_LABELS[engine]}
            </button>
          ))}
        </div>
        <div className={`bt-engine-status ${isConnected ? 'connected' : 'offline'}`}>
          <span className="bt-engine-dot" aria-hidden="true" />
          {liveStatus}
        </div>
      </div>

      {config.engine !== BehaviorTreeEngine.Local && (
        <>
          <div className="bt-engine-session">
            <label className="bt-engine-field">
              <span>Namespace</span>
              <input
                value={config.namespace}
                onChange={(event) => updateConfig({ namespace: event.target.value })}
                placeholder="/arm_1"
                spellCheck={false}
              />
            </label>
            <div className="bt-engine-actions">
              <button type="button" onClick={onPublishSpec} disabled={!isConnected}>
                Sync
              </button>
              <button type="button" onClick={onRunExternal} disabled={!isConnected || validationErrors.length > 0}>
                Run
              </button>
              <button type="button" onClick={onStopExternal} disabled={!isConnected}>
                Stop
              </button>
              <button type="button" onClick={onExportYaml}>
                YAML
              </button>
              <button type="button" onClick={onExportXml}>
                XML
              </button>
            </div>
          </div>

          <details className="bt-runtime-list" aria-label="Published behavior tree nodes" open={!embedded}>
            <summary className="bt-runtime-list-header">
              <span>Published nodes</span>
              <span>{runtimeNodes.length}</span>
            </summary>
            {runtimeNodes.length === 0 ? (
              <div className="bt-runtime-empty">Waiting for a runtime catalog</div>
            ) : (
              runtimeNodes.slice(0, 80).map((node) => (
                <button
                  key={`${node.source ?? 'runtime'}-${node.id}`}
                  type="button"
                  className={`bt-runtime-node${node.id === selectedRuntimeNodeId ? ' selected' : ''}`}
                  onClick={() => onSelectRuntimeNode(node)}
                  title={node.path ?? node.name}
                >
                  <span className={`bt-runtime-node-status status-${node.status ?? ExecutionStatus.Idle}`} />
                  <span className="bt-runtime-node-copy">
                    <span className="bt-runtime-node-name">{node.name}</span>
                    <span className="bt-runtime-node-meta">
                      {[node.type, node.treeId, node.source].filter(Boolean).join(' · ') || node.id}
                    </span>
                  </span>
                </button>
              ))
            )}
          </details>

          {(validationErrors.length > 0 || constraints.length > 0) && (
            <div className="bt-engine-validation" role={validationErrors.length > 0 ? 'alert' : 'status'}>
              {validationErrors.slice(0, 4).map((error) => (
                <div key={error} className="bt-engine-validation-error">{error}</div>
              ))}
              {validationErrors.length === 0 && constraints.slice(0, 4).map((constraint) => (
                <div key={constraint} className="bt-engine-validation-note">{constraint}</div>
              ))}
            </div>
          )}

          <details className="bt-engine-details">
            <summary>Runtime topics</summary>
            <div className="bt-engine-grid">
              <label className="bt-engine-field">
                <span>Catalog topic</span>
                <input
                  value={config.catalogTopic}
                  onChange={(event) => updateConfig({ catalogTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Capabilities</span>
                <input
                  value={config.capabilitiesTopic}
                  onChange={(event) => updateConfig({ capabilitiesTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Trees</span>
                <input
                  value={config.treeCatalogTopic}
                  onChange={(event) => updateConfig({ treeCatalogTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Spec topic</span>
                <input
                  value={config.specTopic}
                  onChange={(event) => updateConfig({ specTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Command</span>
                <input
                  value={config.commandTopic}
                  onChange={(event) => updateConfig({ commandTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Status topic</span>
                <input
                  value={config.statusTopic}
                  onChange={(event) => updateConfig({ statusTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="bt-engine-field">
                <span>Tree topic</span>
                <input
                  value={config.treeTopic}
                  onChange={(event) => updateConfig({ treeTopic: event.target.value })}
                  spellCheck={false}
                />
              </label>
            </div>
          </details>
        </>
      )}
    </div>
  );
};

const getOrderNodeDetail = (node: BehaviorTreeNode): string | undefined => {
  const data = node.data;
  if ('actionName' in data) return data.actionName;
  if ('serviceName' in data) return data.serviceName;
  if ('topicName' in data) return data.topicName;
  return data.label;
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [currentTree, setCurrentTree] = useState<BehaviorTree | null>(null);
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
  const [orderingParentId, setOrderingParentId] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [engineConfig, setEngineConfig] = useState<BehaviorTreeEngineConfig>(
    DEFAULT_ENGINE_CONFIGS[BehaviorTreeEngine.Local]
  );
  const [engineCapabilities, setEngineCapabilities] = useState<BehaviorTreeEngineCapabilities | null>(null);
  const [runtimeTrees, setRuntimeTrees] = useState<BehaviorTreeRuntimeTreeInfo[]>([]);
  const [runtimeNodes, setRuntimeNodes] = useState<BehaviorTreeRuntimeNode[]>([]);
  const [selectedRuntimeNodeId, setSelectedRuntimeNodeId] = useState<string | undefined>();
  const [lastRuntimeMessage, setLastRuntimeMessage] = useState('');
  const [executionSnapshot, setExecutionSnapshot] = useState<BehaviorTreeExecutionSnapshot>({
    isExecuting: false,
    treeName: '',
  });
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const executorRef = useRef<BehaviorTreeExecutor | null>(null);
  const runtimeTopicsRef = useRef<Array<{ unsubscribe: () => void }>>([]);
  const behaviorNodesRef = useRef<BehaviorTreeNode[]>([]);
  const nodeIdCounter = useRef(0);
  const saveNoticeTimer = useRef<number | null>(null);
  const executionNodeLabels = useRef<Map<string, string>>(new Map());
  const executionStartedAt = useRef<number | undefined>(undefined);
  const lastMobileNodeTap = useRef<{ nodeId: string; timestamp: number } | null>(null);

  const { screenToFlowPosition, deleteElements } = useReactFlow();

  useEffect(() => {
    behaviorNodesRef.current = nodes as BehaviorTreeNode[];
  }, [nodes]);

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

  const addEngineNodeAtPosition = useCallback(
    (engineNodeType: BehaviorTreeNodeTypeInfo, position: { x: number; y: number }) => {
      const nodeType = behaviorNodeTypeFromEngineType(engineNodeType);
      setNodes((currentNodes) => {
        const id = allocateNodeId(currentNodes);
        return currentNodes.concat({
          id,
          type: nodeType,
          position,
          data: createNodeDataFromEngineType(engineNodeType),
        });
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
        engine: BehaviorTreeEngine.Local,
        engineConfig: DEFAULT_ENGINE_CONFIGS[BehaviorTreeEngine.Local],
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

  const clearRuntimeSubscriptions = useCallback(() => {
    runtimeTopicsRef.current.forEach((topic) => topic.unsubscribe());
    runtimeTopicsRef.current = [];
  }, []);

  const mergeRuntimeNodes = useCallback((
    incomingNodes: BehaviorTreeRuntimeNode[],
    replace = false,
    replaceOnlyWhenEmpty = false
  ) => {
    if (incomingNodes.length === 0) return;
    setRuntimeNodes((currentNodes) => {
      if (replaceOnlyWhenEmpty && currentNodes.length > 0) return currentNodes;
      const next = replace ? [] : [...currentNodes];
      const currentIndexByLookupKey = new Map<string, number>();
      currentNodes.forEach((node, index) => {
        runtimeNodeLookupKeys(node).forEach((key) => currentIndexByLookupKey.set(key, index));
      });
      const indexByKey = new Map(
        next.map((node, index) => [`${node.source ?? 'runtime'}:${node.id}`, index])
      );
      incomingNodes.forEach((node) => {
        const key = `${node.source ?? 'runtime'}:${node.id}`;
        const matchingCurrentIndex = runtimeNodeLookupKeys(node)
          .map((lookupKey) => currentIndexByLookupKey.get(lookupKey))
          .find((index): index is number => index !== undefined);
        const existingIndex = indexByKey.get(key);
        const existingNode = matchingCurrentIndex !== undefined ? currentNodes[matchingCurrentIndex] : undefined;
        if (existingIndex === undefined) {
          indexByKey.set(key, next.length);
          next.push({
            ...existingNode,
            ...node,
            status: node.status ?? existingNode?.status,
          });
        } else {
          next[existingIndex] = {
            ...next[existingIndex],
            ...node,
            status: node.status ?? next[existingIndex].status ?? existingNode?.status,
          };
        }
      });
      return next;
    });
  }, []);

  useEffect(() => {
    clearRuntimeSubscriptions();
    setLastRuntimeMessage('');
    setRuntimeNodes((currentNodes) => (currentNodes.length === 0 ? currentNodes : []));
    setRuntimeTrees((currentTrees) => (currentTrees.length === 0 ? currentTrees : []));
    setEngineCapabilities((currentCapabilities) => (
      currentCapabilities?.engine === engineConfig.engine ? currentCapabilities : null
    ));

    if (!ros || !isConnected || engineConfig.engine === BehaviorTreeEngine.Local) {
      return;
    }

    const subscribeToStringTopic = (topicName: string, callback: (message: any) => void) => {
      if (!topicName.trim()) return;
      const topic = new ROSLIB.Topic({
        ros,
        name: topicName.trim(),
        messageType: 'std_msgs/msg/String',
      });
      topic.subscribe(callback);
      runtimeTopicsRef.current.push(topic);
    };

    subscribeToStringTopic(engineConfig.capabilitiesTopic, (message) => {
      const capabilities = parseEngineCapabilitiesMessage(message);
      if (!capabilities) return;
      setEngineCapabilities(capabilities);
      if (capabilities.trees && capabilities.trees.length > 0) {
        setRuntimeTrees(capabilities.trees);
      }
    });

    subscribeToStringTopic(engineConfig.treeCatalogTopic, (message) => {
      const trees = parseRuntimeTreeCatalogMessage(message);
      if (trees.length > 0) {
        setRuntimeTrees(trees);
      }
    });

    subscribeToStringTopic(engineConfig.catalogTopic, (message) => {
      mergeRuntimeNodes(parseRuntimeNodeCatalogMessage(message, 'catalog'), true);
    });

    subscribeToStringTopic(engineConfig.statusTopic, (message) => {
      const text = typeof message?.data === 'string' ? message.data : JSON.stringify(message);
      setLastRuntimeMessage(text);
      const statuses = parseRuntimeStatusMessage(message, behaviorNodesRef.current);
      if (statuses.size === 0) return;
      setRuntimeNodes((currentNodes) =>
        currentNodes.map((node) => {
          const status = runtimeNodeStatusFromMap(node, statuses);
          return status && status !== node.status ? { ...node, status } : node;
        })
      );
      const statusValues = Array.from(statuses.values());
      const hasRunningNode = statusValues.some((status) => status === ExecutionStatus.Running);
      const hasTerminalNode = statusValues.some((status) => (
        status === ExecutionStatus.Success || status === ExecutionStatus.Failure
      ));
      if (hasRunningNode) {
        setIsExecuting(true);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: true,
          status: ExecutionStatus.Running,
          activeNodeLabel: prev.activeNodeLabel ?? 'Runtime active',
        }));
      } else if (hasTerminalNode) {
        setIsExecuting(false);
        setExecutionSnapshot((prev) => ({
          ...prev,
          isExecuting: false,
          status: statusValues.some((status) => status === ExecutionStatus.Failure) ? 'error' : 'completed',
        }));
      }
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const direct = statuses.get(node.id);
          const byLabel = statuses.get(String(node.data.label));
          const nextStatus = direct ?? byLabel;
          return nextStatus ? { ...node, data: { ...node.data, status: nextStatus } } : node;
        })
      );
    });

    subscribeToStringTopic(engineConfig.treeTopic, (message) => {
      const text = typeof message?.data === 'string' ? message.data : JSON.stringify(message);
      setLastRuntimeMessage(text);
      mergeRuntimeNodes(parseRuntimeNodeCatalogMessage(message, 'tree'), true, true);
    });

    return clearRuntimeSubscriptions;
  }, [
    clearRuntimeSubscriptions,
    engineConfig.capabilitiesTopic,
    engineConfig.catalogTopic,
    engineConfig.engine,
    engineConfig.statusTopic,
    engineConfig.treeCatalogTopic,
    engineConfig.treeTopic,
    isConnected,
    mergeRuntimeNodes,
    ros,
    setNodes,
  ]);

  useEffect(() => {
    if (
      !ros ||
      !isConnected ||
      engineConfig.engine === BehaviorTreeEngine.Local ||
      engineConfig.namespace.trim()
    ) {
      return;
    }

    const rosApi = ros as any;
    if (typeof rosApi.getTopics !== 'function') return;

    let cancelled = false;
    rosApi.getTopics(
      (result: any) => {
        if (cancelled) return;
        const topics: string[] = Array.isArray(result?.topics) ? result.topics : [];
        const namespace = Array.from(
          new Set(
            topics
              .map(runtimeNamespaceFromTopic)
              .filter((value): value is string => Boolean(value))
          )
        ).sort()[0];

        if (!namespace) return;
        const topicConfig = runtimeTopicConfig(namespace);
        setEngineConfig((currentConfig) => {
          if (
            currentConfig.engine !== engineConfig.engine ||
            currentConfig.namespace.trim()
          ) {
            return currentConfig;
          }
          const nextConfig = { ...currentConfig, namespace, ...topicConfig };
          setCurrentTree((prev) => (
            prev ? { ...prev, engine: nextConfig.engine, engineConfig: nextConfig } : prev
          ));
          return nextConfig;
        });
      },
      () => {
        // Topic discovery is an enhancement; manual namespace entry still works.
      }
    );

    return () => {
      cancelled = true;
    };
  }, [engineConfig.engine, engineConfig.namespace, isConnected, ros]);

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

      let data: {
        nodeType?: BehaviorNodeType;
        rosInfo?: ROSNodeInfo;
        engineNodeType?: BehaviorTreeNodeTypeInfo;
      };
      try {
        data = JSON.parse(dataStr);
      } catch {
        return;
      }

      if (!data.nodeType && !data.engineNodeType) return;

      const position = screenToFlowPosition({
        x: event.clientX - 75,
        y: event.clientY - 40,
      });

      if (data.engineNodeType) {
        addEngineNodeAtPosition(data.engineNodeType, position);
        return;
      }

      if (!data.nodeType) return;
      addNodeAtPosition(data.nodeType, position, data.rosInfo);
    },
    [addEngineNodeAtPosition, addNodeAtPosition, screenToFlowPosition]
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

  const openNodeEditor = useCallback((node: Node) => {
    if (node.type === BehaviorNodeType.Action) {
      setEditingAction({ nodeId: node.id, data: node.data as ROSActionNodeData });
    } else if (node.type === BehaviorNodeType.Service) {
      setEditingService({ nodeId: node.id, data: node.data as ROSServiceNodeData });
    } else if (isOrderedControlNode(node as BehaviorTreeNode)) {
      setOrderingParentId(node.id);
    }
  }, []);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      openNodeEditor(node);
    },
    [openNodeEditor]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!window.matchMedia(MOBILE_BREAKPOINT).matches) return;
      if (
        node.type !== BehaviorNodeType.Action &&
        node.type !== BehaviorNodeType.Service &&
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
    [openNodeEditor]
  );

  const handleSaveActionParameters = useCallback(
    (parameters: Record<string, any>) => {
      if (!editingAction) return;
      const { nodeId } = editingAction;
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id !== nodeId) return node;
          const data = {
            ...node.data,
            parameters,
          };
          if (data.externalKind) {
            data.externalParams = parameters;
          }
          return { ...node, data };
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
          const data = {
            ...node.data,
            request,
          };
          if (data.externalKind) {
            data.externalParams = request;
          }
          return { ...node, data };
        })
      );
    },
    [editingService, setNodes]
  );

  const handleSave = useCallback(() => {
    if (!currentTree) return;
    const updatedTree: BehaviorTree = {
      ...currentTree,
      engine: engineConfig.engine,
      engineConfig,
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
  }, [currentTree, engineConfig, nodes, edges, showSaveNotice]);

  const handleLoad = useCallback((tree: BehaviorTree) => {
    if (!Array.isArray(tree.nodes)) {
      showSaveNotice({
        type: 'error',
        title: 'Load failed',
        message: 'Behavior tree data is missing editable nodes.',
      });
      return;
    }

    const treeEdges = Array.isArray(tree.edges) ? tree.edges : [];
    const loadedConfig = getEngineConfig(tree);
    const loadedNodes = tree.nodes.map((node) => ({
      ...node,
      selected: false,
      dragging: false,
    }));
    const loadedTree = { ...tree, engine: loadedConfig.engine, engineConfig: loadedConfig };
    // Strip legacy sourceHandle values (out-1, out-2, out-3) from saved trees.
    const loadedEdges = treeEdges.map((e) => ({
      ...e,
      sourceHandle: null,
      targetHandle: null,
      selected: false,
    }));
    setCurrentTree({ ...loadedTree, nodes: loadedNodes, edges: loadedEdges });
    setEngineConfig(loadedConfig);
    setSelectedRuntimeNodeId(loadedConfig.selectedRuntimeNodeId);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setSelectedNodes([]);
    setOrderingParentId(null);
    nodeIdCounter.current = getNodeCounterAfterNodes(loadedNodes);
  }, [setNodes, setEdges, showSaveNotice]);

  const handleNew = useCallback(() => {
    if (nodes.length > 0 || edges.length > 0) {
      if (!window.confirm('Create new tree? Unsaved changes will be lost.')) {
        return;
      }
    }
    const newTree: BehaviorTree = {
      id: uuidv4(),
      name: 'Untitled Behavior Tree',
      engine: BehaviorTreeEngine.Local,
      engineConfig: DEFAULT_ENGINE_CONFIGS[BehaviorTreeEngine.Local],
      nodes: [],
      edges: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setCurrentTree(newTree);
    setEngineConfig(DEFAULT_ENGINE_CONFIGS[BehaviorTreeEngine.Local]);
    setSelectedRuntimeNodeId(undefined);
    setRuntimeNodes([]);
    setNodes([]);
    setEdges([]);
    setOrderingParentId(null);
    nodeIdCounter.current = 0;
  }, [nodes, edges, setNodes, setEdges]);

  const handleExport = useCallback(() => {
    if (!currentTree) return;
    exportBehaviorTree({
      ...currentTree,
      engine: engineConfig.engine,
      engineConfig,
      nodes: nodes as BehaviorTreeNode[],
      edges,
    });
  }, [currentTree, engineConfig, nodes, edges]);

  const handleRename = useCallback((name: string) => {
    setCurrentTree((prev) => (prev ? { ...prev, name } : null));
  }, []);

  const handleEngineConfigChange = useCallback((config: BehaviorTreeEngineConfig) => {
    setEngineConfig(config);
    setSelectedRuntimeNodeId(config.selectedRuntimeNodeId);
    setCurrentTree((prev) => (prev ? { ...prev, engine: config.engine, engineConfig: config } : prev));
  }, []);

  const handleSelectRuntimeNode = useCallback((runtimeNode: BehaviorTreeRuntimeNode) => {
    setSelectedRuntimeNodeId(runtimeNode.id);
    setEngineConfig((config) => ({ ...config, selectedRuntimeNodeId: runtimeNode.id }));
    setCurrentTree((prev) =>
      prev
        ? {
          ...prev,
          engineConfig: {
            ...prev.engineConfig,
            selectedRuntimeNodeId: runtimeNode.id,
          },
        }
        : prev
    );

    setNodes((currentNodes) => {
      const runtimeKeys = new Set(
        [runtimeNode.id, runtimeNode.name, runtimeNode.path, runtimeNode.type]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.toLowerCase())
      );
      const matchedNode = currentNodes.find((node) => {
        const data = node.data;
        const graphKeys = [
          node.id,
          data.label,
          data.externalKind,
          'actionName' in data ? data.actionName : undefined,
          'serviceName' in data ? data.serviceName : undefined,
          'topicName' in data ? data.topicName : undefined,
        ].filter((value): value is string => Boolean(value));

        return graphKeys.some((value) => runtimeKeys.has(value.toLowerCase()));
      });

      if (!matchedNode) return currentNodes;
      const selected = currentNodes.map((node) => ({ ...node, selected: node.id === matchedNode.id }));
      setSelectedNodes(selected.filter((node) => node.selected));
      return selected;
    });
  }, [setNodes]);

  const getCurrentTreeForIntegration = useCallback((): BehaviorTree | null => {
    if (!currentTree) return null;
    return {
      ...currentTree,
      engine: engineConfig.engine,
      engineConfig,
      nodes: nodes as BehaviorTreeNode[],
      edges,
      updatedAt: Date.now(),
    };
  }, [currentTree, engineConfig, nodes, edges]);

  const handleExportYaml = useCallback(() => {
    const tree = getCurrentTreeForIntegration();
    if (!tree) return;
    downloadTextFile(
      exportTreeAsYaml(tree),
      `${tree.name.replace(/[^a-z0-9]/gi, '_')}.yaml`,
      'text/yaml'
    );
  }, [getCurrentTreeForIntegration]);

  const handleExportXml = useCallback(() => {
    const tree = getCurrentTreeForIntegration();
    if (!tree) return;
    downloadTextFile(
      exportTreeAsBtCppXml(tree),
      `${tree.name.replace(/[^a-z0-9]/gi, '_')}.xml`,
      'application/xml'
    );
  }, [getCurrentTreeForIntegration]);

  const handlePublishSpec = useCallback(() => {
    const tree = getCurrentTreeForIntegration();
    if (!tree || !ros || !isConnected) return;

    const payload = engineConfig.engine === BehaviorTreeEngine.BehaviorTreeCpp
      ? exportTreeAsBtCppXml(tree)
      : exportTreeAsYaml(tree);
    const topic = new ROSLIB.Topic({
      ros,
      name: engineConfig.specTopic,
      messageType: 'std_msgs/msg/String',
    });
    topic.advertise();
    topic.publish(new ROSLIB.Message({ data: payload }));
    topic.unadvertise();
    showSaveNotice({
      type: 'success',
      title: 'Tree synced',
      message: `Published to ${engineConfig.specTopic}.`,
    });
  }, [engineConfig.engine, engineConfig.specTopic, getCurrentTreeForIntegration, isConnected, ros, showSaveNotice]);

  const publishRuntimeCommand = useCallback((command: Record<string, unknown>) => {
    if (!ros || !isConnected || !engineConfig.commandTopic.trim()) return;
    const topic = new ROSLIB.Topic({
      ros,
      name: engineConfig.commandTopic,
      messageType: 'std_msgs/msg/String',
    });
    topic.advertise();
    topic.publish(new ROSLIB.Message({ data: JSON.stringify(command) }));
    topic.unadvertise();
  }, [engineConfig.commandTopic, isConnected, ros]);

  const handleRunExternal = useCallback(() => {
    const tree = getCurrentTreeForIntegration();
    if (!tree) return;
    if (!ros || !isConnected) {
      showSaveNotice({
        type: 'error',
        title: 'Runtime offline',
        message: 'Connect to ROS before running an external behavior tree engine.',
      });
      return;
    }
    handlePublishSpec();
    publishRuntimeCommand({
      command: 'load_and_run',
      treeId: tree.id,
      name: tree.name,
      engine: engineConfig.engine,
      format: engineConfig.engine === BehaviorTreeEngine.BehaviorTreeCpp ? 'xml' : 'yaml',
    });
    executionStartedAt.current = Date.now();
    setIsExecuting(true);
    setExecutionSnapshot({
      isExecuting: true,
      treeName: tree.name,
      activeNodeLabel: 'Runtime starting',
      status: ExecutionStatus.Running,
      startedAt: executionStartedAt.current,
    });
  }, [
    engineConfig.engine,
    getCurrentTreeForIntegration,
    handlePublishSpec,
    isConnected,
    publishRuntimeCommand,
    ros,
    showSaveNotice,
  ]);

  const handleStopExternal = useCallback(() => {
    publishRuntimeCommand({
      command: 'stop',
      engine: engineConfig.engine,
      selectedRuntimeNodeId,
    });
    setIsExecuting(false);
    setExecutionSnapshot((prev) => ({
      ...prev,
      isExecuting: false,
      status: 'stopped',
    }));
  }, [engineConfig.engine, publishRuntimeCommand, selectedRuntimeNodeId]);

  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      if (event.nodeId && event.data?.status) {
        const nodeId = event.nodeId;
        setNodes((nds) =>
          nds.map((node) => {
            if (node.id === nodeId) {
              return { ...node, data: { ...node.data, status: event.data.status } };
            }
            return node;
          })
        );

        const status = event.data.status as ExecutionStatus;
        if (status === ExecutionStatus.Running) {
          setExecutionSnapshot((prev) => ({
            ...prev,
            isExecuting: true,
            activeNodeId: nodeId,
            activeNodeLabel: executionNodeLabels.current.get(nodeId) ?? nodeId,
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
    if (engineConfig.engine !== BehaviorTreeEngine.Local) {
      handleRunExternal();
      return;
    }
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
    executionNodeLabels.current = new Map(
      treeToExecute.nodes.map((node) => [node.id, node.data.label || node.id])
    );
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
  }, [engineConfig.engine, ros, isConnected, currentTree, nodes, edges, handleExecutionEvent, handleRunExternal]);

  const handleStop = useCallback(() => {
    if (engineConfig.engine !== BehaviorTreeEngine.Local) {
      handleStopExternal();
    }
    if (executorRef.current) executorRef.current.stop();
    setIsExecuting(false);
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: { ...node.data, status: ExecutionStatus.Idle },
      }))
    );
    setExecutionSnapshot((prev) => ({
      ...prev,
      isExecuting: false,
      status: 'stopped',
    }));
  }, [engineConfig.engine, handleStopExternal, setNodes]);

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

  const handleAddEngineNode = useCallback(
    (engineNodeType: BehaviorTreeNodeTypeInfo) => {
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = screenToFlowPosition({
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      });

      addEngineNodeAtPosition(engineNodeType, position);
    },
    [addEngineNodeAtPosition, screenToFlowPosition]
  );

  const handleLoadRuntimeTree = useCallback(
    (runtimeTree: BehaviorTreeRuntimeTreeInfo) => {
      if (!runtimeTree.spec) {
        showSaveNotice({
          type: 'error',
          title: 'Tree spec unavailable',
          message: `${runtimeTree.name} is listed by the engine but did not include an editable spec.`,
        });
        return;
      }

      try {
        const fileName = runtimeTree.format === 'xml'
          ? 'tree.xml'
          : runtimeTree.format === 'json'
            ? 'tree.json'
            : 'tree.yaml';
        const loadedTree = importTreeFromText(runtimeTree.spec, fileName);
        if (!Array.isArray(loadedTree.nodes)) {
          throw new Error('Runtime tree spec does not include editable nodes.');
        }
        handleLoad({
          ...loadedTree,
          id: runtimeTree.id || loadedTree.id,
          name: runtimeTree.name || loadedTree.name,
          engine: engineConfig.engine,
          engineConfig,
        });
      } catch (error) {
        showSaveNotice({
          type: 'error',
          title: 'Load failed',
          message: error instanceof Error ? error.message : 'Could not parse the engine tree.',
        });
      }
    },
    [engineConfig, handleLoad, showSaveNotice]
  );

  const behaviorNodes = useMemo(() => nodes as BehaviorTreeNode[], [nodes]);
  const engineNodeTypes = useMemo(
    () => engineCapabilities?.nodeTypes?.length ? engineCapabilities.nodeTypes : DEFAULT_NODE_TYPES,
    [engineCapabilities]
  );
  const engineConstraints = useMemo(
    () => engineCapabilities?.constraints ?? [],
    [engineCapabilities]
  );
  const validationErrors = useMemo(() => {
    const tree = getCurrentTreeForIntegration();
    return tree ? validateBehaviorTreeForEngine(tree, engineNodeTypes) : [];
  }, [engineNodeTypes, getCurrentTreeForIntegration]);
  const displayedEdges = useMemo(
    () => annotateOrderedEdges(behaviorNodes, edges),
    [behaviorNodes, edges]
  );
  const orderingParent = useMemo(() => {
    const parent = behaviorNodes.find((node) => node.id === orderingParentId);
    return isOrderedControlNode(parent) ? parent : null;
  }, [behaviorNodes, orderingParentId]);
  const selectedOrderedChildLinks = useMemo(
    () => (orderingParent ? getOrderedChildLinks(orderingParent.id, behaviorNodes, edges) : []),
    [behaviorNodes, edges, orderingParent]
  );
  const engineLiveStatus = useMemo(() => {
    if (engineConfig.engine === BehaviorTreeEngine.Local) return 'Local executor';
    if (!isConnected) return 'ROS offline';
    return lastRuntimeMessage ? 'Live runtime' : 'Listening';
  }, [engineConfig.engine, isConnected, lastRuntimeMessage]);
  const handleCycleBackend = useCallback(() => {
    const engines = [
      BehaviorTreeEngine.Local,
      BehaviorTreeEngine.PyTrees,
      BehaviorTreeEngine.BehaviorTreeCpp,
    ];
    const currentIndex = engines.indexOf(engineConfig.engine);
    const nextEngine = engines[(currentIndex + 1) % engines.length];
    const nextConfig: BehaviorTreeEngineConfig = nextEngine === BehaviorTreeEngine.Local
      ? { ...DEFAULT_ENGINE_CONFIGS[nextEngine] }
      : {
          ...DEFAULT_ENGINE_CONFIGS[nextEngine],
          namespace: engineConfig.namespace,
          ...runtimeTopicConfig(engineConfig.namespace),
        };
    handleEngineConfigChange(nextConfig);
  }, [engineConfig.engine, engineConfig.namespace, handleEngineConfigChange]);
  const handleMoveOrderedChild = useCallback(
    (edgeId: string, direction: -1 | 1) => {
      if (!orderingParent) return;
      setEdges((currentEdges) =>
        moveOrderedChildEdge(currentEdges, orderingParent.id, edgeId, direction)
      );
    },
    [orderingParent, setEdges]
  );
  const handlePaneClick = useCallback(() => {
    setOrderingParentId(null);
  }, []);

  return (
    <div className="behavior-tree-panel" data-testid="behavior-tree-panel">
      <BehaviorTreeToolbar
        currentTree={currentTree}
        isExecuting={isExecuting}
        isPaletteCollapsed={isPaletteCollapsed}
        selectedNodeCount={selectedNodes.length}
        backendLabel={ENGINE_LABELS[engineConfig.engine]}
        backendStatus={engineLiveStatus}
        backendConnected={engineConfig.engine === BehaviorTreeEngine.Local || isConnected}
        engineSettings={(
          <EngineIntegrationPanel
            config={engineConfig}
            isConnected={isConnected}
            liveStatus={engineLiveStatus}
            runtimeNodes={runtimeNodes}
            constraints={engineConstraints}
            validationErrors={validationErrors}
            selectedRuntimeNodeId={selectedRuntimeNodeId}
            embedded
            onConfigChange={handleEngineConfigChange}
            onSelectRuntimeNode={handleSelectRuntimeNode}
            onExportYaml={handleExportYaml}
            onExportXml={handleExportXml}
            onPublishSpec={handlePublishSpec}
            onRunExternal={handleRunExternal}
            onStopExternal={handleStopExternal}
          />
        )}
        onSave={handleSave}
        onLoad={handleLoad}
        onNew={handleNew}
        onExecute={handleExecute}
        onStop={handleStop}
        onExport={handleExport}
        onTogglePalette={() => setIsPaletteCollapsed((collapsed) => !collapsed)}
        onCycleBackend={handleCycleBackend}
        onDeleteSelected={handleDeleteSelected}
        onDuplicateSelected={handleDuplicateSelected}
        onRename={handleRename}
        engineTrees={engineConfig.engine === BehaviorTreeEngine.Local ? [] : runtimeTrees}
        onLoadEngineTree={handleLoadRuntimeTree}
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
          engineNodeTypes={engineConfig.engine === BehaviorTreeEngine.Local ? [] : engineNodeTypes}
          onAddEngineNode={handleAddEngineNode}
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
          ros={editingAction.data.externalKind ? null : ros}
          onSave={handleSaveActionParameters}
          onClose={() => setEditingAction(null)}
        />
      )}
      {editingService && (
        <ServiceParameterEditor
          nodeData={editingService.data}
          ros={editingService.data.externalKind ? null : ros}
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
