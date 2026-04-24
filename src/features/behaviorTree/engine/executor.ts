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

// action_msgs/msg/GoalStatus values – we treat anything other than SUCCEEDED
// as a failure for the BT step.
const GOAL_STATUS_SUCCEEDED = 4;

// ROS 2 action goal_id is a unique_identifier_msgs/UUID, which is a 16-byte
// array. rosbridge accepts it as a plain JS number array.
function generateGoalUuid(): number[] {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf);
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
   * Find the root node (no incoming edges)
   */
  private findRootNode(): BehaviorTreeNode | null {
    const nodesWithIncoming = new Set(this.tree.edges.map((e) => e.target));
    return this.tree.nodes.find((node) => !nodesWithIncoming.has(node.id)) || null;
  }

  /**
   * Get child nodes of a given node
   */
  private getChildNodes(nodeId: string): BehaviorTreeNode[] {
    const childIds = this.tree.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => edge.target);

    return this.tree.nodes.filter((node) => childIds.includes(node.id));
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
   * roslib 1.4.x ships only the ROS 1 actionlib client (`ROSLIB.ActionClient` /
   * `ROSLIB.Goal`), which talks to topics like `<server>/goal`, `<server>/result`,
   * etc. ROS 2 action servers don't expose those — they expose three services
   * (`send_goal`, `get_result`, `cancel_goal`) and two topics (`feedback`,
   * `status`) under the `_action/` namespace. So we drive them by hand:
   *
   *   1. send_goal service -> get back {accepted, stamp}
   *   2. get_result service -> blocks until the action completes, returns
   *      {status, result}; status == 4 (SUCCEEDED) means BT success.
   *   3. on stop()/timeout, cancel_goal service with the same goal_id.
   *
   * The action interface type (e.g. "as2_msgs/action/Takeoff") must come from
   * discovery — without it we cannot construct the auto-generated service types
   * (`<Action>_SendGoal`, `<Action>_GetResult`).
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
      const settle = (status: ExecutionStatus) => {
        if (settled) return;
        settled = true;
        this.activeActions.delete(node.id);
        clearTimeout(timeoutId);
        resolve(status);
      };

      // Default 30 s — same as before. Caller can override per-node via
      // `data.timeout`.
      const timeout = data.timeout || 30000;
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

        // Use saved parameters; fall back to the hardcoded template for this
        // action type so nodes without saved params still send a valid goal.
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
            if (!this.isRunning) {
              settle(ExecutionStatus.Failure);
              return;
            }
            if (!resp || resp.accepted === false) {
              console.warn(`[BT] Action "${data.actionName}" rejected goal`);
              settle(ExecutionStatus.Failure);
              return;
            }

            // Goal accepted — block on get_result. This service call only
            // returns once the action server has finished, so it doubles as
            // our "wait for completion" primitive.
            const getResult = new (ROSLIB as any).Service({
              ros: this.ros,
              name: `${data.actionName}/_action/get_result`,
              serviceType: `${data.actionType}_GetResult`,
            });
            const getResultReq = new (ROSLIB as any).ServiceRequest({
              goal_id: { uuid },
            });

            getResult.callService(
              getResultReq,
              (res: any) => {
                const status = res?.status;
                if (status === GOAL_STATUS_SUCCEEDED) {
                  settle(ExecutionStatus.Success);
                } else {
                  console.warn(
                    `[BT] Action "${data.actionName}" finished with status ${status}`
                  );
                  settle(ExecutionStatus.Failure);
                }
              },
              (err: any) => {
                console.error(`[BT] get_result failed for "${data.actionName}":`, err);
                settle(ExecutionStatus.Failure);
              }
            );
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

