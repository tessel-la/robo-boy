import ROSLIB, { Ros } from 'roslib';
import {
  BehaviorTree,
  BehaviorTreeNode,
  ExecutionStatus,
  ExecutionEvent,
  ExecutionCallback,
  BehaviorNodeType,
  ROSActionNodeData,
  ROSServiceNodeData,
  SubtreeNodeData,
  ROSTopicNodeData,
} from '../types';
import { ACTION_TEMPLATES } from '../actionTemplates';
import { ActionFieldSchema, fetchActionGoalDetails } from '../services/rosDiscovery';

// Tracks an in-flight ROS2 action goal so stop()/timeout can cancel it via
// rosbridge's action protocol.
interface ActiveAction {
  actionName: string;
  requestId: string;
}

// action_msgs/msg/GoalStatus values
const GOAL_STATUS_SUCCEEDED = 4;
const GOAL_STATUS_CANCELED = 5;
const GOAL_STATUS_ABORTED = 6;

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

/**
 * Behavior Tree Executor - Hybrid execution model
 * Browser orchestrates control flow, ROS executes individual actions
 */
export class BehaviorTreeExecutor {
  private ros: Ros;
  private tree: BehaviorTree;
  private nodeStatuses: Map<string, ExecutionStatus>;
  private isRunning: boolean;
  private callback: ExecutionCallback;
  private abortController: AbortController | null;
  private activeActions: Map<string, ActiveAction>;
  private readonly rootPath: string[];

  constructor(tree: BehaviorTree, ros: Ros, callback: ExecutionCallback) {
    this.tree = tree;
    this.ros = ros;
    this.callback = callback;
    this.nodeStatuses = new Map();
    this.isRunning = false;
    this.abortController = null;
    this.activeActions = new Map();
    this.rootPath = [];

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
    this.abortController = new AbortController();

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

      this.emitEvent({
        type: 'completed',
        timestamp: Date.now(),
        data: { result },
      });
    } catch (error) {
      this.emitEvent({
        type: 'error',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.isRunning = false;
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

    this.emitEvent({
      type: 'stopped',
      timestamp: Date.now(),
    });
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
        n.type === BehaviorNodeType.Parallel
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
    treePath: string[] = this.rootPath
  ): Promise<ExecutionStatus> {
    if (!this.isRunning) {
      return ExecutionStatus.Failure;
    }

    this.setNodeStatus(node.id, ExecutionStatus.Running, treePath);

    try {
      let result: ExecutionStatus;

      switch (node.type) {
        case BehaviorNodeType.Sequence:
          result = await this.executeSequence(node, tree, treePath);
          break;
        case BehaviorNodeType.Selector:
          result = await this.executeSelector(node, tree, treePath);
          break;
        case BehaviorNodeType.Parallel:
          result = await this.executeParallel(node, tree, treePath);
          break;
        case BehaviorNodeType.Subtree:
          result = await this.executeSubtreeNode(node, treePath);
          break;
        case BehaviorNodeType.Action:
          result = await this.executeActionNode(node);
          break;
        case BehaviorNodeType.Service:
          result = await this.executeServiceNode(node);
          break;
        case BehaviorNodeType.Topic:
          result = await this.executeTopicNode(node);
          break;
        default:
          console.warn(`Unknown node type: ${node.type}`);
          result = ExecutionStatus.Failure;
      }

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
    treePath: string[] = this.rootPath
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    for (const child of children) {
      const result = await this.executeNode(child, tree, treePath);

      if (result === ExecutionStatus.Failure) {
        return ExecutionStatus.Failure;
      }

      if (!this.isRunning) {
        return ExecutionStatus.Failure;
      }
    }

    return ExecutionStatus.Success;
  }

  /**
   * Execute selector node (first child to succeed wins)
   */
  private async executeSelector(
    node: BehaviorTreeNode,
    tree: BehaviorTree = this.tree,
    treePath: string[] = this.rootPath
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    for (const child of children) {
      const result = await this.executeNode(child, tree, treePath);

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
    treePath: string[] = this.rootPath
  ): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id, tree);

    const results = await Promise.all(children.map(child => this.executeNode(child, tree, treePath)));

    // Success if all children succeed
    const allSuccess = results.every(r => r === ExecutionStatus.Success);
    return allSuccess ? ExecutionStatus.Success : ExecutionStatus.Failure;
  }

  private async executeSubtreeNode(
    node: BehaviorTreeNode,
    treePath: string[] = this.rootPath
  ): Promise<ExecutionStatus> {
    const data = node.data as SubtreeNodeData;
    const subtreeRoot = this.findRootNode(data.tree);

    if (!subtreeRoot) {
      console.warn(`[BT] Subtree "${data.label}" has no root node`);
      return ExecutionStatus.Failure;
    }

    return this.executeNode(subtreeRoot, data.tree, [...treePath, node.id]);
  }

  /**
   * Execute a ROS 2 action node.
   *
   * roslib 1.4.x ships only the ROS 1 actionlib client, which is incompatible
   * with ROS 2 action servers. rosbridge has a ROS 2 action protocol, so we
   * send goals with `send_action_goal` and listen for its `action_result`
   * websocket response.
   */
  private async executeActionNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSActionNodeData;

    return new Promise(resolve => {
      if (!data.actionType) {
        console.error(
          `[BT] Action node "${data.actionName}" has no actionType. ` +
            `Re-run ROS discovery so the feedback topic type can be captured.`
        );
        resolve(ExecutionStatus.Failure);
        return;
      }

      const requestId = createActionRequestId(node.id);
      let settled = false;
      let removeActionListener: (() => void) | null = null;

      const settle = (status: ExecutionStatus) => {
        if (settled) return;
        settled = true;
        this.activeActions.delete(node.id);
        clearTimeout(timeoutId);
        removeActionListener?.();
        removeActionListener = null;
        resolve(status);
      };

      // Default 60 s timeout — drone behaviors can take a while.
      const timeout = data.timeout || 60000;
      const timeoutId = setTimeout(() => {
        console.warn(`[BT] Action "${data.actionName}" timed out after ${timeout}ms`);
        this.cancelActionGoal(data.actionName, requestId);
        settle(ExecutionStatus.Failure);
      }, timeout);

      void (async () => {
        try {
          // Use saved parameters; fall back to the hardcoded template.
          const hasParams = data.parameters && Object.keys(data.parameters).length > 0;
          const rawGoal = hasParams ? data.parameters : (ACTION_TEMPLATES[data.actionType] ?? {});

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

          if (settled || !this.isRunning) return;

          console.log(`[BT] send_action_goal payload for "${data.actionName}":`, JSON.stringify(goal));

          removeActionListener = addRosbridgeActionListener(this.ros, message => {
            if (message.op !== 'action_result' || message.id !== requestId) return;

            console.log(`[BT] action_result for "${data.actionName}":`, JSON.stringify(message));
            if (!this.isRunning) {
              settle(ExecutionStatus.Failure);
              return;
            }

            if (message.result === false) {
              console.error(`[BT] send_action_goal failed for "${data.actionName}":`, message.values);
              settle(ExecutionStatus.Failure);
              return;
            }

            if (message.status === GOAL_STATUS_SUCCEEDED) {
              console.log(`[BT] Action "${data.actionName}" succeeded`);
              settle(ExecutionStatus.Success);
            } else if (message.status === GOAL_STATUS_CANCELED || message.status === GOAL_STATUS_ABORTED) {
              console.warn(`[BT] Action "${data.actionName}" ended with status ${message.status}`);
              settle(ExecutionStatus.Failure);
            } else {
              console.warn(`[BT] Action "${data.actionName}" returned unexpected status ${message.status}`);
              settle(ExecutionStatus.Failure);
            }
          });

          this.activeActions.set(node.id, { actionName: data.actionName, requestId });

          (this.ros as any).callOnConnection({
            op: 'send_action_goal',
            id: requestId,
            action: data.actionName,
            action_type: data.actionType,
            args: goal,
          });
        } catch (error) {
          console.error('[BT] Error executing action node:', error);
          settle(ExecutionStatus.Failure);
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
  private async executeServiceNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSServiceNodeData;

    return new Promise(resolve => {
      try {
        const service = new ROSLIB.Service({
          ros: this.ros,
          name: data.serviceName,
          serviceType: data.serviceType,
        });

        const request = new ROSLIB.ServiceRequest(data.request || {});

        const timeout = data.timeout || 10000; // Default 10 seconds
        const timeoutId = setTimeout(() => {
          resolve(ExecutionStatus.Failure);
        }, timeout);

        service.callService(
          request,
          result => {
            clearTimeout(timeoutId);
            // Service call succeeded
            resolve(ExecutionStatus.Success);
          },
          error => {
            clearTimeout(timeoutId);
            console.error('Service call failed:', error);
            resolve(ExecutionStatus.Failure);
          }
        );
      } catch (error) {
        console.error('Error executing service node:', error);
        resolve(ExecutionStatus.Failure);
      }
    });
  }

  /**
   * Execute ROS topic publish node
   */
  private async executeTopicNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSTopicNodeData;

    return new Promise(resolve => {
      try {
        const topic = new ROSLIB.Topic({
          ros: this.ros,
          name: data.topicName,
          messageType: data.messageType,
        });

        const message = new ROSLIB.Message(data.message || {});

        topic.publish(message);

        // Publishing is fire-and-forget, consider it successful immediately
        resolve(ExecutionStatus.Success);

        // Unadvertise if publish once
        if (data.publishOnce !== false) {
          topic.unadvertise();
        }
      } catch (error) {
        console.error('Error executing topic node:', error);
        resolve(ExecutionStatus.Failure);
      }
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
