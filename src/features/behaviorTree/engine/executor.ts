import ROSLIB, { Ros } from 'roslib';
import {
  BehaviorTree,
  BehaviorTreeNode,
  ExecutionStatus,
  ExecutionEvent,
  ExecutionCallback,
  BehaviorNodeType,
  ControlFlowNodeData,
  ROSActionNodeData,
  ROSServiceNodeData,
  SubtreeNodeData,
  ROSTopicNodeData,
  ROSSubscriberNodeData,
  TimeoutNodeData,
  IfElseNodeData,
} from '../types';
import { ACTION_TEMPLATES } from '../actionTemplates';
import { ActionFieldSchema, fetchActionGoalDetails } from '../services/rosDiscovery';
import {
  GOAL_STATUS,
  extractDiagnostics,
  goalStatusName,
  phaseForGoalStatus,
  type ExecutionError,
  type ExecutionUpdate,
} from '../execution/executionModel';
import {
  Blackboard,
  applyInputBindings,
  applyOutputBindings,
  createBlackboard,
  evaluateBlackboardValue,
} from '../blackboard';

// Tracks an in-flight ROS2 action goal so stop()/timeout can cancel it via
// rosbridge's action protocol.
interface ActiveAction {
  actionName: string;
  requestId: string;
}


const ROS_BOOL_TYPES = new Set(['bool', 'boolean']);
const ROS_FLOAT_TYPES = new Set(['float32', 'float64', 'float', 'double']);
const ROS_INT_TYPES = new Set([
  'byte',
  'char',
  'int',
  'uint',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
]);

interface RosbridgeActionMessage {
  op?: string;
  id?: string;
  action?: string;
  result?: boolean;
  status?: number;
  values?: unknown;
}

type RosbridgeActionListener = (message: RosbridgeActionMessage) => void;

interface RosWithActionBridge extends Ros {
  __btActionBridgeListeners?: Set<RosbridgeActionListener>;
}

function createActionRequestId(nodeId: string): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const suffix = Array.from(buf, v => v.toString(16).padStart(2, '0')).join('');
  return `bt-action-${nodeId}-${suffix}`;
}

function parseRosbridgeJsonFrame(event: unknown): RosbridgeActionMessage | null {
  const data = typeof event === 'string' ? event : (event as { data?: unknown } | null)?.data;
  if (typeof data !== 'string') return null;

  try {
    return JSON.parse(data) as RosbridgeActionMessage;
  } catch {
    return null;
  }
}

function ensureRosbridgeActionBridge(ros: Ros): void {
  const bridgedRos = ros as RosWithActionBridge & { socket?: any };
  bridgedRos.__btActionBridgeListeners ??= new Set();

  const socket = bridgedRos.socket;
  if (!socket || socket.__btActionBridgeInstalled) return;

  const originalOnMessage = typeof socket.onmessage === 'function' ? socket.onmessage.bind(socket) : null;

  socket.onmessage = (event: unknown) => {
    const message = parseRosbridgeJsonFrame(event);
    if (message?.op === 'action_result' || message?.op === 'action_feedback') {
      bridgedRos.__btActionBridgeListeners?.forEach(listener => listener(message));
    }
    originalOnMessage?.(event);
  };
  socket.__btActionBridgeInstalled = true;
}

function addRosbridgeActionListener(ros: Ros, listener: RosbridgeActionListener): () => void {
  const bridgedRos = ros as RosWithActionBridge & {
    on?: (event: string, listener: () => void) => void;
    off?: (event: string, listener: () => void) => void;
    removeListener?: (event: string, listener: () => void) => void;
  };
  bridgedRos.__btActionBridgeListeners ??= new Set();
  bridgedRos.__btActionBridgeListeners.add(listener);

  const installOnConnection = () => ensureRosbridgeActionBridge(ros);
  ensureRosbridgeActionBridge(ros);
  bridgedRos.on?.('connection', installOnConnection);

  return () => {
    bridgedRos.__btActionBridgeListeners?.delete(listener);
    if (bridgedRos.off) {
      bridgedRos.off('connection', installOnConnection);
    } else {
      bridgedRos.removeListener?.('connection', installOnConnection);
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapParameterValue(value: unknown): unknown {
  if (!isRecord(value)) return value;

  if ('value' in value) return value.value;
  if ('data' in value && Object.keys(value).length === 1) return value.data;

  return value;
}

function normalizeNumber(value: unknown, fallback: number, integer: boolean): number {
  const unwrapped = unwrapParameterValue(value);
  const safeFallback = Number.isFinite(fallback) ? fallback : 0;
  const parsed =
    typeof unwrapped === 'number'
      ? unwrapped
      : typeof unwrapped === 'string' && unwrapped.trim() !== ''
        ? Number(unwrapped)
        : safeFallback;

  if (!Number.isFinite(parsed)) return safeFallback;
  return integer ? Math.trunc(parsed) : parsed;
}

function normalizeBool(value: unknown, fallback: boolean): boolean {
  const unwrapped = unwrapParameterValue(value);
  if (typeof unwrapped === 'boolean') return unwrapped;
  if (typeof unwrapped === 'number') return unwrapped !== 0;
  if (typeof unwrapped === 'string') {
    const lower = unwrapped.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) return true;
    if (['false', '0', 'no', 'off'].includes(lower)) return false;
  }
  return fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  const unwrapped = unwrapParameterValue(value);
  if (typeof unwrapped === 'string') return unwrapped;
  if (typeof unwrapped === 'number' || typeof unwrapped === 'boolean') return String(unwrapped);
  return fallback;
}

function isQuaternionField(field: ActionFieldSchema): boolean {
  const names = field.subfields?.map(subfield => subfield.name).sort().join(',');
  return field.rosType.endsWith('/Quaternion') || (field.name === 'orientation' && names === 'w,x,y,z');
}

function normalizeQuaternionRecord(value: Record<string, unknown>, fallback: unknown): Record<string, number> {
  const fallbackRecord = isRecord(fallback) ? fallback : {};
  const x = normalizeNumber(value.x, Number(fallbackRecord.x ?? 0), false);
  const y = normalizeNumber(value.y, Number(fallbackRecord.y ?? 0), false);
  const z = normalizeNumber(value.z, Number(fallbackRecord.z ?? 0), false);
  const w = normalizeNumber(value.w, Number(fallbackRecord.w ?? 1), false);
  const norm = Math.hypot(x, y, z, w);

  if (!Number.isFinite(norm) || norm < 1e-12) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return { x: x / norm, y: y / norm, z: z / norm, w: w / norm };
}

function normalizeActionFieldValue(value: unknown, fallback: unknown, field: ActionFieldSchema): unknown {
  const unwrapped = unwrapParameterValue(value);

  if (field.arrayLen >= 0) {
    return Array.isArray(unwrapped) ? unwrapped : Array.isArray(fallback) ? fallback : [];
  }

  if (field.subfields?.length) {
    if (isQuaternionField(field)) {
      return normalizeQuaternionRecord(isRecord(unwrapped) ? unwrapped : {}, fallback);
    }

    return normalizeActionGoalPayload(
      isRecord(unwrapped) ? unwrapped : {},
      field.subfields,
      isRecord(fallback) ? fallback : {}
    );
  }

  if (ROS_BOOL_TYPES.has(field.rosType)) return normalizeBool(unwrapped, fallback === true);
  if (ROS_FLOAT_TYPES.has(field.rosType)) return normalizeNumber(unwrapped, Number(fallback ?? 0), false);
  if (ROS_INT_TYPES.has(field.rosType)) return normalizeNumber(unwrapped, Number(fallback ?? 0), true);
  if (field.rosType === 'string') return normalizeString(unwrapped, typeof fallback === 'string' ? fallback : '');

  return unwrapped ?? fallback;
}

function normalizeActionGoalPayload(
  rawGoal: Record<string, unknown>,
  fields: ActionFieldSchema[],
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const source = isRecord(rawGoal.goal) && !fields.some(field => field.name in rawGoal) ? rawGoal.goal : rawGoal;
  const normalized: Record<string, unknown> = {};

  for (const field of fields) {
    normalized[field.name] = normalizeActionFieldValue(source[field.name], defaults[field.name], field);
  }

  return normalized;
}

const CONNECTION_LOST: Omit<ExecutionUpdate, 'attemptId' | 'kind' | 'target'> = {
  phase: 'transport',
  error: { message: 'The connection to ROS was lost.', source: 'transport' },
};

const formatDuration = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

/** What ROS said went wrong: rosbridge sends a string, some servers a structured error. */
function describeRosError(value: unknown, fallback: string): ExecutionError {
  if (typeof value === 'string' && value.trim()) return { message: value.trim(), source: 'ros' };
  const diagnostics = extractDiagnostics(value);
  return {
    message: diagnostics.message ?? fallback,
    code: diagnostics.code,
    source: 'ros',
    details: value === undefined || typeof value === 'string' ? undefined : value,
  };
}

/**
 * Behavior Tree Executor - Hybrid execution model
 * Browser orchestrates control flow, ROS executes individual actions
 */
export class BehaviorTreeExecutor {
  private ros: Ros;
  private tree: BehaviorTree;
  private nodeStatuses: Map<string, ExecutionStatus>;
  private isRunning: boolean;
  private isPaused: boolean;
  private callback: ExecutionCallback;
  private abortController: AbortController | null;
  private activeActions: Map<string, ActiveAction>;
  private readonly rootPath: string[];
  private serviceAttempts = 0;
  private pausePromise: Promise<void> | null;
  private resolvePause: (() => void) | null;
  private blackboard: Blackboard;

  constructor(tree: BehaviorTree, ros: Ros, callback: ExecutionCallback) {
    this.tree = tree;
    this.ros = ros;
    this.callback = callback;
    this.nodeStatuses = new Map();
    this.isRunning = false;
    this.isPaused = false;
    this.abortController = null;
    this.activeActions = new Map();
    this.rootPath = [];
    this.pausePromise = null;
    this.resolvePause = null;
    this.blackboard = createBlackboard(tree.blackboardDefaults);

    // Initialize all nodes to idle status
    tree.nodes.forEach(node => {
      this.nodeStatuses.set(node.id, ExecutionStatus.Idle);
    });
  }

  /**
   * Start executing the behavior tree
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('Behavior tree is already running');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.blackboard = createBlackboard(this.tree.blackboardDefaults);

    this.emitEvent({
      type: 'started',
      timestamp: Date.now(),
    });

    try {
      // Find root node (node with no incoming edges)
      const rootNode = this.findRootNode();
      if (!rootNode) {
        throw new Error('No root node found in behavior tree');
      }

      // Execute from root
      const result = await this.executeNode(rootNode, this.tree, this.rootPath);

      if (this.isRunning) {
        this.emitEvent({
          type: 'completed',
          timestamp: Date.now(),
          data: { result },
        });
      }
    } catch (error) {
      this.emitEvent({
        type: 'error',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isRunning = false;
      this.isPaused = false;
      this.releasePauseWaiters();
      this.abortController = null;
    }
  }

  /**
   * Stop execution
   */
  public stop(): void {
    if (!this.isRunning) return;

    // Cancel any in-flight ROS2 action goals via rosbridge's action protocol.
    this.activeActions.forEach(({ actionName, requestId }) => {
      this.cancelActionGoal(actionName, requestId);
    });
    this.activeActions.clear();

    if (this.abortController) {
      this.abortController.abort();
    }

    this.isRunning = false;
    this.isPaused = false;
    this.releasePauseWaiters();

    this.emitEvent({
      type: 'stopped',
      timestamp: Date.now(),
    });
  }

  public pause(): void {
    if (!this.isRunning || this.isPaused) return;

    this.isPaused = true;
    this.pausePromise = new Promise<void>((resolve) => {
      this.resolvePause = resolve;
    });
    this.emitEvent({ type: 'paused', timestamp: Date.now() });
  }

  public resume(): void {
    if (!this.isRunning || !this.isPaused) return;

    this.isPaused = false;
    this.releasePauseWaiters();
    this.emitEvent({ type: 'resumed', timestamp: Date.now() });
  }

  private releasePauseWaiters(): void {
    this.resolvePause?.();
    this.resolvePause = null;
    this.pausePromise = null;
  }

  private async waitWhilePaused(): Promise<void> {
    if (this.isPaused && this.pausePromise) {
      await this.pausePromise;
    }
  }

  /**
   * Get current status of a node
   */
  public getNodeStatus(nodeId: string, treePath: string[] = this.rootPath): ExecutionStatus {
    return this.nodeStatuses.get(this.getExecutionNodeKey(nodeId, treePath)) || ExecutionStatus.Idle;
  }

  /**
   * Get all node statuses
   */
  public getAllStatuses(): Map<string, ExecutionStatus> {
    return new Map(this.nodeStatuses);
  }

  public getBlackboard(): Record<string, unknown> {
    return Object.fromEntries(this.blackboard);
  }

  private emitBlackboardUpdate(changedVariables: string[]): void {
    if (changedVariables.length === 0) return;
    this.emitEvent({
      type: 'blackboardUpdated',
      timestamp: Date.now(),
      data: { changedVariables, blackboard: this.getBlackboard() },
    });
  }

  private getExecutionNodeKey(nodeId: string, treePath: string[]): string {
    return `${treePath.join('/') || 'root'}::${nodeId}`;
  }

  /**
   * Find the root node (no incoming edges).
   * Prefers control-flow nodes over leaf nodes in case of ambiguity.
   */
  private findRootNode(tree: BehaviorTree = this.tree): BehaviorTreeNode | null {
    const nodesWithIncoming = new Set(tree.edges.map(e => e.target));
    const roots = tree.nodes.filter(node => !nodesWithIncoming.has(node.id));
    console.log(
      `[BT] findRootNode: ${roots.length} root candidate(s):`,
      roots.map(n => `${n.id}(${n.type})`).join(', ')
    );
    // Prefer a control-flow node as root — avoids picking a lone action when
    // edges were drawn in the wrong direction (action→sequence instead of seq→action).
    const controlRoot = roots.find(
      n =>
        n.type === BehaviorNodeType.Sequence ||
        n.type === BehaviorNodeType.Selector ||
        n.type === BehaviorNodeType.Parallel ||
        n.type === BehaviorNodeType.Retry ||
        n.type === BehaviorNodeType.Repeat
        || n.type === BehaviorNodeType.Timeout
        || n.type === BehaviorNodeType.IfElse
    );
    return controlRoot ?? roots[0] ?? null;
  }

  /**
   * Get child nodes of a given node, in edge-insertion order.
   */
  private getChildNodes(nodeId: string, tree: BehaviorTree = this.tree): BehaviorTreeNode[] {
    const childIds = tree.edges.filter(edge => edge.source === nodeId).map(edge => edge.target);

    console.log(
      `[BT] getChildNodes(${nodeId}): ${childIds.length} child(ren) — edges:`,
      tree.edges
        .filter(e => e.source === nodeId)
        .map(e => `${e.source}→${e.target}`)
        .join(', ')
    );

    // Preserve the order edges were added (not the nodes-array order).
    return childIds
      .map(id => tree.nodes.find(n => n.id === id))
      .filter((n): n is BehaviorTreeNode => n !== undefined);
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal: AbortSignal | undefined = this.abortController?.signal
  ): Promise<ExecutionStatus> {
    await this.waitWhilePaused();
    if (!this.isRunning || signal?.aborted) {
      return ExecutionStatus.Failure;
    }

    this.setNodeStatus(node.id, ExecutionStatus.Running, treePath);

    try {
      let result: ExecutionStatus;

      switch (node.type) {
        case BehaviorNodeType.Sequence:
          result = await this.executeSequence(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Selector:
          result = await this.executeSelector(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Parallel:
          result = await this.executeParallel(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Retry:
          result = await this.executeRetry(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Repeat:
          result = await this.executeRepeat(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Timeout:
          result = await this.executeTimeout(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.IfElse:
          result = await this.executeIfElse(node, tree, treePath, signal);
          break;
        case BehaviorNodeType.Subtree:
          result = await this.executeSubtreeNode(node, treePath, signal);
          break;
        case BehaviorNodeType.Action:
          result = await this.executeActionNode(node, treePath, signal);
          break;
        case BehaviorNodeType.Service:
          result = await this.executeServiceNode(node, treePath, signal);
          break;
        case BehaviorNodeType.Topic:
          result = await this.executeTopicNode(node, signal);
          break;
        case BehaviorNodeType.Subscriber:
          result = await this.executeSubscriberNode(node, signal);
          break;
        default:
          console.warn(`Unknown node type: ${node.type}`);
          result = ExecutionStatus.Failure;
      }

      await this.waitWhilePaused();
      if (!this.isRunning || signal?.aborted) return ExecutionStatus.Failure;
      this.setNodeStatus(node.id, result, treePath);
      return result;
    } catch (error) {
      console.error(`Error executing node ${node.id}:`, error);
      this.setNodeStatus(node.id, ExecutionStatus.Failure, treePath);
      return ExecutionStatus.Failure;
    }
  }

  /**
   * Execute sequence node (all children must succeed)
   */
  private async executeSequence(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    for (const child of children) {
      const result = await this.executeNode(child, tree, treePath, signal);

      if (result === ExecutionStatus.Failure) {
        return ExecutionStatus.Failure;
      }

      if (!this.isRunning) {
        return ExecutionStatus.Failure;
      }
    }

    return ExecutionStatus.Success;
  }

  private getIterationLimit(node: BehaviorTreeNode): number {
    const limit = (node.data as ControlFlowNodeData).iterationLimit;
    if (limit === -1) return -1;
    if (typeof limit !== 'number' || !Number.isFinite(limit)) return 3;
    return Math.max(1, Math.trunc(limit));
  }

  private async executeChildrenAsSequence(
    children: BehaviorTreeNode[],
    tree: BehaviorTree,
    treePath: string[],
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    if (children.length === 0) return ExecutionStatus.Failure;

    for (const child of children) {
      const result = await this.executeNode(child, tree, treePath, signal);
      if (result === ExecutionStatus.Failure || !this.isRunning) {
        return ExecutionStatus.Failure;
      }
    }

    return ExecutionStatus.Success;
  }

  private async yieldBetweenIterations(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Execute retry node. Children are executed as a sequence. If that sequence
   * fails, retry until it succeeds or the iteration limit is exhausted.
   */
  private async executeRetry(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);
    const limit = this.getIterationLimit(node);
    let attempt = 0;

    while (this.isRunning && !signal?.aborted && (limit === -1 || attempt < limit)) {
      attempt += 1;
      const result = await this.executeChildrenAsSequence(children, tree, treePath, signal);
      if (result === ExecutionStatus.Success) return ExecutionStatus.Success;
      await this.yieldBetweenIterations();
    }

    return ExecutionStatus.Failure;
  }

  /**
   * Execute repeat node. Children are executed as a sequence. If that sequence
   * succeeds, repeat until the iteration limit is reached. A child failure fails
   * the repeat node.
   */
  private async executeRepeat(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);
    const limit = this.getIterationLimit(node);
    let completedRepeats = 0;

    while (this.isRunning && !signal?.aborted && (limit === -1 || completedRepeats < limit)) {
      const result = await this.executeChildrenAsSequence(children, tree, treePath, signal);
      if (result === ExecutionStatus.Failure) return ExecutionStatus.Failure;
      completedRepeats += 1;
      if (limit === -1 || completedRepeats < limit) {
        await this.yieldBetweenIterations();
      }
    }

    return this.isRunning ? ExecutionStatus.Success : ExecutionStatus.Failure;
  }

  /**
   * Execute selector node (first child to succeed wins)
   */
  private async executeSelector(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    for (const child of children) {
      const result = await this.executeNode(child, tree, treePath, signal);

      if (result === ExecutionStatus.Success) {
        return ExecutionStatus.Success;
      }

      if (!this.isRunning) {
        return ExecutionStatus.Failure;
      }
    }

    return ExecutionStatus.Failure;
  }

  /**
   * Execute parallel node (all children execute simultaneously)
   */
  private async executeParallel(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    const results = await Promise.all(children.map(child => this.executeNode(child, tree, treePath, signal)));

    // Success if all children succeed
    const allSuccess = results.every(r => r === ExecutionStatus.Success);
    return allSuccess ? ExecutionStatus.Success : ExecutionStatus.Failure;
  }

  private async executeTimeout(
    node: BehaviorTreeNode,
    tree: BehaviorTree,
    treePath: string[],
    parentSignal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const child = this.getChildNodes(node.id, tree)[0];
    if (!child) return ExecutionStatus.Failure;

    const timeout = Math.max(1, Math.trunc((node.data as TimeoutNodeData).timeout || 10000));
    const controller = new AbortController();
    const abortChild = () => controller.abort();
    parentSignal?.addEventListener('abort', abortChild, { once: true });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ExecutionStatus>(resolve => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(ExecutionStatus.Failure);
      }, timeout);
    });

    try {
      return await Promise.race([
        this.executeNode(child, tree, treePath, controller.signal),
        deadline,
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortChild);
    }
  }

  private async executeIfElse(
    node: BehaviorTreeNode,
    tree: BehaviorTree,
    treePath: string[],
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const data = node.data as IfElseNodeData;
    const exists = this.blackboard.has(data.variable);
    const condition = evaluateBlackboardValue(
      this.blackboard.get(data.variable),
      data.operator,
      data.expectedValue,
      exists
    );
    const branchHandle = condition ? 'then' : 'else';
    const branchEdge = tree.edges.find(edge => edge.source === node.id && edge.sourceHandle === branchHandle);
    const fallbackChildren = this.getChildNodes(node.id, tree);
    const fallbackChild = fallbackChildren[condition ? 0 : 1];
    const child = branchEdge
      ? tree.nodes.find(candidate => candidate.id === branchEdge.target)
      : fallbackChild;
    return child
      ? this.executeNode(child, tree, treePath, signal)
      : ExecutionStatus.Failure;
  }

  private async executeSubtreeNode(
    node: BehaviorTreeNode,
    treePath: string[] = this.rootPath,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const data = node.data as SubtreeNodeData;
    const subtreeRoot = this.findRootNode(data.tree);

    if (!subtreeRoot) {
      console.warn(`[BT] Subtree "${data.label}" has no root node`);
      return ExecutionStatus.Failure;
    }

    Object.entries(data.tree.blackboardDefaults || {}).forEach(([key, value]) => {
      if (!this.blackboard.has(key)) this.blackboard.set(key, value);
    });
    return this.executeNode(subtreeRoot, data.tree, [...treePath, node.id], signal);
  }

  /**
   * Execute a ROS 2 action node.
   *
   * roslib 1.4.x ships only the ROS 1 actionlib client, which is incompatible
   * with ROS 2 action servers. rosbridge has a ROS 2 action protocol, so we
   * send goals with `send_action_goal` and listen for its `action_result`
   * websocket response.
   */
  private async executeActionNode(
    node: BehaviorTreeNode,
    treePath: string[],
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const data = node.data as ROSActionNodeData;
    const requestId = createActionRequestId(node.id);
    const report = this.executionReporter(node.id, treePath, {
      attemptId: requestId,
      kind: 'action',
      target: data.actionName,
      rosType: data.actionType,
    });
    report({ phase: 'running', begin: true });

    return new Promise(resolve => {
      if (!data.actionType) {
        const message = `Action "${data.actionName}" has no type. Re-run ROS discovery so its type can be captured.`;
        console.error(`[BT] ${message}`);
        report({ phase: 'failed', error: { message, source: 'client' } });
        resolve(ExecutionStatus.Failure);
        return;
      }

      let settled = false;
      let removeActionListener: (() => void) | null = null;
      let removeCloseListener: () => void = () => {};
      let onAbort = () => {};

      const settle = (status: ExecutionStatus, update: Omit<ExecutionUpdate, 'attemptId' | 'kind' | 'target'>) => {
        if (settled) return;
        settled = true;
        this.activeActions.delete(node.id);
        clearTimeout(timeoutId);
        removeActionListener?.();
        removeActionListener = null;
        removeCloseListener();
        signal?.removeEventListener('abort', onAbort);
        report(update);
        resolve(status);
      };

      // Default 60 s timeout — drone behaviors can take a while.
      const timeout = data.timeout || 60000;
      const timeoutId = setTimeout(() => {
        console.warn(`[BT] Action "${data.actionName}" timed out after ${timeout}ms`);
        this.cancelActionGoal(data.actionName, requestId);
        settle(ExecutionStatus.Failure, this.timeoutUpdate(`No result from ${data.actionName}`, timeout));
      }, timeout);
      onAbort = () => {
        this.cancelActionGoal(data.actionName, requestId);
        settle(ExecutionStatus.Failure, {
          phase: 'cancelled',
          error: { message: 'Cancelled because the tree stopped.', source: 'stopped' },
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      removeCloseListener = this.onConnectionLost(() => settle(ExecutionStatus.Failure, CONNECTION_LOST));

      void (async () => {
        try {
          // Use saved parameters; fall back to the hardcoded template.
          const hasParams = data.parameters && Object.keys(data.parameters).length > 0;
          const staticGoal = hasParams ? data.parameters : (ACTION_TEMPLATES[data.actionType] ?? {});
          const rawGoal = applyInputBindings(staticGoal || {}, data.inputBindings, this.blackboard);

          if (!hasParams) {
            console.warn(
              `[BT] Action "${data.actionName}" has no saved parameters — ` +
                `using ${ACTION_TEMPLATES[data.actionType] ? 'template' : 'empty {}'} for "${data.actionType}". ` +
                `Double-click the node to set parameters.`
            );
          }

          const details = await fetchActionGoalDetails(this.ros, data.actionType);
          const goal =
            details && isRecord(rawGoal)
              ? normalizeActionGoalPayload(rawGoal, details.fields, details.defaults)
              : rawGoal;

          await this.waitWhilePaused();
          if (settled || !this.isRunning) {
            settle(ExecutionStatus.Failure, {
              phase: 'cancelled',
              error: { message: 'Cancelled because the tree stopped.', source: 'stopped' },
            });
            return;
          }

          console.log(`[BT] send_action_goal payload for "${data.actionName}":`, JSON.stringify(goal));

          removeActionListener = addRosbridgeActionListener(this.ros, message => {
            if (message.id !== requestId || settled) return;

            if (message.op === 'action_feedback') {
              report({ phase: 'running', feedback: message.values });
              return;
            }
            if (message.op !== 'action_result') return;

            console.log(`[BT] action_result for "${data.actionName}":`, JSON.stringify(message));
            if (!this.isRunning) {
              settle(ExecutionStatus.Failure, {
                phase: 'cancelled',
                error: { message: 'Cancelled because the tree stopped.', source: 'stopped' },
              });
              return;
            }

            // rosbridge could not run the goal at all (no server, a bad goal…): its reason is in `values`.
            if (message.result === false && message.status === undefined) {
              console.error(`[BT] send_action_goal failed for "${data.actionName}":`, message.values);
              settle(ExecutionStatus.Failure, {
                phase: 'failed',
                error: describeRosError(message.values, `${data.actionName} could not run the goal`),
              });
              return;
            }

            const phase = phaseForGoalStatus(message.status);
            if (phase === 'succeeded') {
              console.log(`[BT] Action "${data.actionName}" succeeded`);
              this.emitBlackboardUpdate(
                applyOutputBindings(message.values, data.outputBindings, this.blackboard)
              );
              settle(ExecutionStatus.Success, { phase, goalStatus: message.status, result: message.values });
              return;
            }

            console.warn(`[BT] Action "${data.actionName}" ended with status ${message.status}`);
            const diagnostics = extractDiagnostics(message.values);
            const statusName = goalStatusName(message.status) ?? 'an unknown status';
            settle(ExecutionStatus.Failure, {
              phase,
              goalStatus: message.status,
              result: message.values,
              error: {
                message: diagnostics.message
                  ?? (message.status === GOAL_STATUS.ABORTED || message.status === GOAL_STATUS.CANCELED
                    ? `The goal was ${statusName.toLowerCase()}.`
                    : `The goal ended with ${statusName.toLowerCase()}.`),
                code: diagnostics.code ?? message.status,
                source: 'ros',
              },
            });
          });

          this.activeActions.set(node.id, { actionName: data.actionName, requestId });

          (this.ros as any).callOnConnection({
            op: 'send_action_goal',
            id: requestId,
            action: data.actionName,
            action_type: data.actionType,
            args: goal,
            feedback: true,
          });
        } catch (error) {
          console.error('[BT] Error executing action node:', error);
          settle(ExecutionStatus.Failure, {
            phase: 'failed',
            error: { message: error instanceof Error ? error.message : String(error), source: 'client' },
          });
        }
      })();
    });
  }

  /**
   * Cancel an in-flight ROS 2 action goal via rosbridge's action protocol.
   * Best-effort: we don't wait for the response.
   */
  private cancelActionGoal(actionName: string, requestId: string): void {
    try {
      (this.ros as any).callOnConnection({
        op: 'cancel_action_goal',
        id: requestId,
        action: actionName,
      });
    } catch (error) {
      console.error(`[BT] Failed to cancel action "${actionName}":`, error);
    }
  }

  /**
   * Execute ROS service node
   */
  private async executeServiceNode(
    node: BehaviorTreeNode,
    treePath: string[],
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const data = node.data as ROSServiceNodeData;
    this.serviceAttempts += 1;
    const report = this.executionReporter(node.id, treePath, {
      attemptId: `bt-service-${node.id}-${this.serviceAttempts}`,
      kind: 'service',
      target: data.serviceName,
      rosType: data.serviceType,
    });
    report({ phase: 'running', begin: true });

    return new Promise(resolve => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let removeCloseListener: () => void = () => {};
      const onAbort = () => settle(ExecutionStatus.Failure, {
        phase: 'cancelled',
        error: { message: 'Cancelled because the tree stopped.', source: 'stopped' },
      });
      const settle = (status: ExecutionStatus, update: Omit<ExecutionUpdate, 'attemptId' | 'kind' | 'target'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        removeCloseListener();
        signal?.removeEventListener('abort', onAbort);
        report(update);
        resolve(status);
      };

      try {
        const service = new ROSLIB.Service({
          ros: this.ros,
          name: data.serviceName,
          serviceType: data.serviceType,
        });

        const request = new ROSLIB.ServiceRequest(
          applyInputBindings(data.request || {}, data.inputBindings, this.blackboard)
        );

        const timeout = data.timeout || 10000; // Default 10 seconds
        timeoutId = setTimeout(() => {
          settle(ExecutionStatus.Failure, this.timeoutUpdate(`No response from ${data.serviceName}`, timeout));
        }, timeout);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        removeCloseListener = this.onConnectionLost(() => settle(ExecutionStatus.Failure, CONNECTION_LOST));

        service.callService(
          request,
          result => {
            if (settled) return;
            this.emitBlackboardUpdate(
              applyOutputBindings(result, data.outputBindings, this.blackboard)
            );
            // A response that reports failure itself (`success: false`…) still completes the call: the node
            // succeeds as it always has, and the details show what the service said.
            settle(ExecutionStatus.Success, { phase: 'succeeded', result });
          },
          error => {
            console.error('Service call failed:', error);
            settle(ExecutionStatus.Failure, {
              phase: 'failed',
              error: describeRosError(error, `${data.serviceName} failed`),
            });
          }
        );
      } catch (error) {
        console.error('Error executing service node:', error);
        settle(ExecutionStatus.Failure, {
          phase: 'failed',
          error: { message: error instanceof Error ? error.message : String(error), source: 'client' },
        });
      }
    });
  }

  /** Reports one execution of a node: its start, feedback and outcome, all tagged with the attempt. */
  private executionReporter(
    nodeId: string,
    treePath: string[],
    identity: Pick<ExecutionUpdate, 'attemptId' | 'kind' | 'target' | 'rosType'>
  ): (update: Omit<ExecutionUpdate, 'attemptId' | 'kind' | 'target' | 'rosType'>) => void {
    return update => {
      this.emitEvent({
        type: 'nodeExecution',
        nodeId,
        timestamp: Date.now(),
        data: { treePath, execution: { ...identity, ...update, at: Date.now() } },
      });
    };
  }

  /** A call that ran out of time; when ROS itself was gone, that is the reason instead. */
  private timeoutUpdate(message: string, timeoutMs: number): Omit<ExecutionUpdate, 'attemptId' | 'kind' | 'target'> {
    if (this.ros.isConnected === false) return CONNECTION_LOST;
    return {
      phase: 'timeout',
      error: { message: `${message} within ${formatDuration(timeoutMs)}.`, source: 'timeout' },
    };
  }

  /** Calls back once if the ROS connection closes; returns how to stop listening. */
  private onConnectionLost(callback: () => void): () => void {
    const ros = this.ros as Ros & {
      on?: (event: string, listener: () => void) => void;
      off?: (event: string, listener: () => void) => void;
      removeListener?: (event: string, listener: () => void) => void;
    };
    if (typeof ros.on !== 'function') return () => {};
    ros.on('close', callback);
    return () => {
      if (ros.off) ros.off('close', callback);
      else ros.removeListener?.('close', callback);
    };
  }

  /**
   * Execute ROS topic publish node
   */
  private async executeTopicNode(node: BehaviorTreeNode, signal?: AbortSignal): Promise<ExecutionStatus> {
    const data = node.data as ROSTopicNodeData;

    return new Promise(resolve => {
      try {
        const topic = new ROSLIB.Topic({
          ros: this.ros,
          name: data.topicName,
          messageType: data.messageType,
        });

        const payload = applyInputBindings(data.message || {}, data.inputBindings, this.blackboard);
        const message = new ROSLIB.Message(payload);
        const frequencyHz = Number(data.frequencyHz || 0);
        if (!(frequencyHz > 0)) {
          topic.publish(message);
          topic.unadvertise();
          resolve(ExecutionStatus.Success);
          return;
        }

        const intervalMs = Math.max(10, 1000 / frequencyHz);
        const durationMs = Math.max(0, Number(data.durationMs ?? 1000));
        const startedAt = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (status: ExecutionStatus) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          topic.unadvertise();
          resolve(status);
        };
        const onAbort = () => finish(ExecutionStatus.Failure);
        const publishNext = async () => {
          if (signal?.aborted || !this.isRunning) {
            finish(ExecutionStatus.Failure);
            return;
          }
          await this.waitWhilePaused();
          if (signal?.aborted || !this.isRunning) {
            finish(ExecutionStatus.Failure);
            return;
          }
          if (durationMs > 0 && Date.now() - startedAt >= durationMs) {
            finish(ExecutionStatus.Success);
            return;
          }
          topic.publish(message);
          timer = setTimeout(publishNext, intervalMs);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        void publishNext();
      } catch (error) {
        console.error('Error executing topic node:', error);
        resolve(ExecutionStatus.Failure);
      }
    });
  }

  private async executeSubscriberNode(
    node: BehaviorTreeNode,
    signal?: AbortSignal
  ): Promise<ExecutionStatus> {
    const data = node.data as ROSSubscriberNodeData;
    return new Promise(resolve => {
      const topic = new ROSLIB.Topic({
        ros: this.ros,
        name: data.topicName,
        messageType: data.messageType,
      });
      let settled = false;
      const finish = (status: ExecutionStatus) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        topic.unsubscribe();
        resolve(status);
      };
      const onMessage = (message: unknown) => {
        this.emitBlackboardUpdate(
          applyOutputBindings(message, data.outputBindings, this.blackboard)
        );
        finish(ExecutionStatus.Success);
      };
      const onAbort = () => finish(ExecutionStatus.Failure);
      const timeoutId = setTimeout(
        () => finish(ExecutionStatus.Failure),
        Math.max(1, Math.trunc(data.timeout || 10000))
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        finish(ExecutionStatus.Failure);
        return;
      }
      topic.subscribe(onMessage);
    });
  }

  /**
   * Set node status and emit event
   */
  private setNodeStatus(nodeId: string, status: ExecutionStatus, treePath: string[] = this.rootPath): void {
    this.nodeStatuses.set(this.getExecutionNodeKey(nodeId, treePath), status);

    let eventType: 'nodeRunning' | 'nodeSuccess' | 'nodeFailure' | 'nodeEntered';

    switch (status) {
      case ExecutionStatus.Running:
        eventType = 'nodeRunning';
        break;
      case ExecutionStatus.Success:
        eventType = 'nodeSuccess';
        break;
      case ExecutionStatus.Failure:
        eventType = 'nodeFailure';
        break;
      default:
        eventType = 'nodeEntered';
    }

    this.emitEvent({
      type: eventType,
      nodeId,
      timestamp: Date.now(),
      data: { status, treePath },
    });
  }

  /**
   * Emit execution event
   */
  private emitEvent(event: ExecutionEvent): void {
    this.callback(event);
  }
}
