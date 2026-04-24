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
  ROSTopicNodeData,
} from '../types';
import { ACTION_TEMPLATES } from '../actionTemplates';

// Tracks an in-flight ROS2 action goal so stop()/timeout can cancel it via
// the action's underlying cancel_goal service.
interface ActiveAction {
  actionName: string;
  uuid: number[];
}

// action_msgs/msg/GoalStatus values
const GOAL_STATUS_SUCCEEDED = 4;
const GOAL_STATUS_CANCELED  = 5;
const GOAL_STATUS_ABORTED   = 6;

// ROS 2 action goal_id is a unique_identifier_msgs/UUID (16-byte array).
// rosbridge accepts a plain JS number[] when sending, but encodes uint8[16]
// as a base64 string when delivering topic messages.
function generateGoalUuid(): number[] {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf);
}

/**
 * Normalise a UUID value received from rosbridge.
 * Outgoing (sent by us): number[16] — rosbridge encodes to ROS bytes.
 * Incoming (from topic): base64 string OR number[] depending on rosbridge ver.
 * We accept either form and return a number[].
 */
function decodeRosbridgeUuid(raw: number[] | string | undefined): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const bin = atob(raw);
      return Array.from({ length: bin.length }, (_, i) => bin.charCodeAt(i));
    } catch { return null; }
  }
  return null;
}

/** Compare two 16-byte UUID arrays for equality. */
function uuidMatches(a: number[], b: number[]): boolean {
  return a.length === 16 && b.length === 16 && a.every((v, i) => v === b[i]);
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

  constructor(tree: BehaviorTree, ros: Ros, callback: ExecutionCallback) {
    this.tree = tree;
    this.ros = ros;
    this.callback = callback;
    this.nodeStatuses = new Map();
    this.isRunning = false;
    this.abortController = null;
    this.activeActions = new Map();

    // Initialize all nodes to idle status
    tree.nodes.forEach((node) => {
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
      const result = await this.executeNode(rootNode);
      
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

    // Cancel any in-flight ROS2 action goals via their cancel_goal service.
    this.activeActions.forEach(({ actionName, uuid }) => {
      this.cancelActionGoal(actionName, uuid);
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
  public getNodeStatus(nodeId: string): ExecutionStatus {
    return this.nodeStatuses.get(nodeId) || ExecutionStatus.Idle;
  }

  /**
   * Get all node statuses
   */
  public getAllStatuses(): Map<string, ExecutionStatus> {
    return new Map(this.nodeStatuses);
  }

  /**
   * Find the root node (no incoming edges).
   * Prefers control-flow nodes over leaf nodes in case of ambiguity.
   */
  private findRootNode(): BehaviorTreeNode | null {
    const nodesWithIncoming = new Set(this.tree.edges.map((e) => e.target));
    const roots = this.tree.nodes.filter((node) => !nodesWithIncoming.has(node.id));
    console.log(`[BT] findRootNode: ${roots.length} root candidate(s):`,
      roots.map((n) => `${n.id}(${n.type})`).join(', '));
    // Prefer a control-flow node as root — avoids picking a lone action when
    // edges were drawn in the wrong direction (action→sequence instead of seq→action).
    const controlRoot = roots.find((n) =>
      n.type === BehaviorNodeType.Sequence ||
      n.type === BehaviorNodeType.Selector ||
      n.type === BehaviorNodeType.Parallel
    );
    return controlRoot ?? roots[0] ?? null;
  }

  /**
   * Get child nodes of a given node, in edge-insertion order.
   */
  private getChildNodes(nodeId: string): BehaviorTreeNode[] {
    const childIds = this.tree.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => edge.target);

    console.log(`[BT] getChildNodes(${nodeId}): ${childIds.length} child(ren) — edges:`,
      this.tree.edges.filter((e) => e.source === nodeId).map((e) => `${e.source}→${e.target}`).join(', '));

    // Preserve the order edges were added (not the nodes-array order).
    return childIds
      .map((id) => this.tree.nodes.find((n) => n.id === id))
      .filter((n): n is BehaviorTreeNode => n !== undefined);
  }

  /**
   * Execute a single node
   */
  private async executeNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    if (!this.isRunning) {
      return ExecutionStatus.Failure;
    }

    this.setNodeStatus(node.id, ExecutionStatus.Running);

    try {
      let result: ExecutionStatus;

      switch (node.type) {
        case BehaviorNodeType.Sequence:
          result = await this.executeSequence(node);
          break;
        case BehaviorNodeType.Selector:
          result = await this.executeSelector(node);
          break;
        case BehaviorNodeType.Parallel:
          result = await this.executeParallel(node);
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

      this.setNodeStatus(node.id, result);
      return result;
    } catch (error) {
      console.error(`Error executing node ${node.id}:`, error);
      this.setNodeStatus(node.id, ExecutionStatus.Failure);
      return ExecutionStatus.Failure;
    }
  }

  /**
   * Execute sequence node (all children must succeed)
   */
  private async executeSequence(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id);

    for (const child of children) {
      const result = await this.executeNode(child);
      
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
  private async executeSelector(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id);

    for (const child of children) {
      const result = await this.executeNode(child);
      
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
  private async executeParallel(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const children = this.getChildNodes(node.id);
    
    const results = await Promise.all(
      children.map((child) => this.executeNode(child))
    );

    // Success if all children succeed
    const allSuccess = results.every((r) => r === ExecutionStatus.Success);
    return allSuccess ? ExecutionStatus.Success : ExecutionStatus.Failure;
  }

  /**
   * Execute a ROS 2 action node.
   *
   * roslib 1.4.x ships only the ROS 1 actionlib client, which is incompatible
   * with ROS 2 action servers. We drive ROS 2 actions by hand:
   *
   *   1. send_goal service → get back {accepted, stamp}
   *   2. Subscribe to <action>/_action/status topic and watch for our goal_id
   *      reaching a terminal state (SUCCEEDED=4, CANCELED=5, ABORTED=6).
   *      We use the topic instead of get_result because get_result is a
   *      long-blocking service call that rosbridge times out.
   *   3. On stop()/timeout → cancel_goal service + unsubscribe.
   */
  private async executeActionNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSActionNodeData;

    return new Promise((resolve) => {
      if (!data.actionType) {
        console.error(
          `[BT] Action node "${data.actionName}" has no actionType. ` +
            `Re-run ROS discovery so the feedback topic type can be captured.`
        );
        resolve(ExecutionStatus.Failure);
        return;
      }

      const uuid = generateGoalUuid();
      let settled = false;
      let statusTopic: any = null;

      const settle = (status: ExecutionStatus) => {
        if (settled) return;
        settled = true;
        this.activeActions.delete(node.id);
        clearTimeout(timeoutId);
        if (statusTopic) {
          try { statusTopic.unsubscribe(); } catch { /* best effort */ }
          statusTopic = null;
        }
        resolve(status);
      };

      // Default 60 s timeout — drone behaviors can take a while.
      const timeout = data.timeout || 60000;
      const timeoutId = setTimeout(() => {
        console.warn(`[BT] Action "${data.actionName}" timed out after ${timeout}ms`);
        this.cancelActionGoal(data.actionName, uuid);
        settle(ExecutionStatus.Failure);
      }, timeout);

      try {
        const sendGoal = new (ROSLIB as any).Service({
          ros: this.ros,
          name: `${data.actionName}/_action/send_goal`,
          serviceType: `${data.actionType}_SendGoal`,
        });

        // Use saved parameters; fall back to the hardcoded template.
        const hasParams = data.parameters && Object.keys(data.parameters).length > 0;
        const goal = hasParams
          ? data.parameters
          : (ACTION_TEMPLATES[data.actionType] ?? {});

        if (!hasParams) {
          console.warn(
            `[BT] Action "${data.actionName}" has no saved parameters — ` +
            `using ${ACTION_TEMPLATES[data.actionType] ? 'template' : 'empty {}'} for "${data.actionType}". ` +
            `Double-click the node to set parameters.`
          );
        }

        const sendGoalReq = new (ROSLIB as any).ServiceRequest({
          goal_id: { uuid },
          goal,
        });

        this.activeActions.set(node.id, { actionName: data.actionName, uuid });

        sendGoal.callService(
          sendGoalReq,
          (resp: any) => {
            console.log(`[BT] send_goal response for "${data.actionName}":`, JSON.stringify(resp));
            if (!this.isRunning) { settle(ExecutionStatus.Failure); return; }
            if (!resp || resp.accepted === false) {
              console.warn(
                `[BT] Action "${data.actionName}" rejected goal. ` +
                `Goal sent: ${JSON.stringify(goal)}. ` +
                `Full response: ${JSON.stringify(resp)}`
              );
              settle(ExecutionStatus.Failure);
              return;
            }

            // Goal accepted — subscribe to _action/status to detect completion.
            // We avoid the blocking get_result service because rosbridge times
            // out long-running service calls (typically after ~5-10 s).
            statusTopic = new (ROSLIB as any).Topic({
              ros: this.ros,
              name: `${data.actionName}/_action/status`,
              messageType: 'action_msgs/msg/GoalStatusArray',
            });

            statusTopic.subscribe((msg: any) => {
              const list: any[] = msg?.status_list ?? [];
              // Log raw UUID format on first message so we can diagnose encoding issues.
              if (list.length > 0) {
                const rawUuid = list[0]?.goal_info?.goal_id?.uuid;
                console.log(`[BT] status tick for "${data.actionName}": ` +
                  `${list.length} goal(s), uuid[0] type=${typeof rawUuid}`, rawUuid);
              }
              for (const entry of list) {
                const entryUuid = decodeRosbridgeUuid(entry?.goal_info?.goal_id?.uuid);
                if (!entryUuid || !uuidMatches(entryUuid, uuid)) continue;

                const status: number = entry?.status ?? 0;
                if (status === GOAL_STATUS_SUCCEEDED) {
                  console.log(`[BT] Action "${data.actionName}" succeeded`);
                  settle(ExecutionStatus.Success);
                } else if (status === GOAL_STATUS_CANCELED || status === GOAL_STATUS_ABORTED) {
                  console.warn(`[BT] Action "${data.actionName}" ended with status ${status}`);
                  settle(ExecutionStatus.Failure);
                }
                // ACCEPTED(1) / EXECUTING(2) / CANCELING(3) → keep waiting
              }
            });
          },
          (err: any) => {
            console.error(`[BT] send_goal failed for "${data.actionName}":`, err);
            settle(ExecutionStatus.Failure);
          }
        );
      } catch (error) {
        console.error('[BT] Error executing action node:', error);
        settle(ExecutionStatus.Failure);
      }
    });
  }

  /**
   * Cancel an in-flight ROS 2 action goal via its cancel_goal service.
   * Best-effort: we don't wait for the response.
   */
  private cancelActionGoal(actionName: string, uuid: number[]): void {
    try {
      const cancel = new (ROSLIB as any).Service({
        ros: this.ros,
        name: `${actionName}/_action/cancel_goal`,
        serviceType: 'action_msgs/srv/CancelGoal',
      });
      const req = new (ROSLIB as any).ServiceRequest({
        goal_info: {
          goal_id: { uuid },
          stamp: { sec: 0, nanosec: 0 },
        },
      });
      cancel.callService(req, () => {}, () => {});
    } catch (error) {
      console.error(`[BT] Failed to cancel action "${actionName}":`, error);
    }
  }

  /**
   * Execute ROS service node
   */
  private async executeServiceNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSServiceNodeData;
    
    return new Promise((resolve) => {
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
          (result) => {
            clearTimeout(timeoutId);
            // Service call succeeded
            resolve(ExecutionStatus.Success);
          },
          (error) => {
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
    
    return new Promise((resolve) => {
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
  private setNodeStatus(nodeId: string, status: ExecutionStatus): void {
    this.nodeStatuses.set(nodeId, status);

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
      data: { status },
    });
  }

  /**
   * Emit execution event
   */
  private emitEvent(event: ExecutionEvent): void {
    this.callback(event);
  }
}


