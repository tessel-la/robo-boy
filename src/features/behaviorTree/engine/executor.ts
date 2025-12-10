import ROSLIB, { Ros, Topic, Service, ActionClient, Goal } from 'roslib';
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
  ControlFlowNodeData,
} from '../types';
import { Edge } from 'reactflow';

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
  private activeGoals: Map<string, Goal>;

  constructor(tree: BehaviorTree, ros: Ros, callback: ExecutionCallback) {
    this.tree = tree;
    this.ros = ros;
    this.callback = callback;
    this.nodeStatuses = new Map();
    this.isRunning = false;
    this.abortController = null;
    this.activeGoals = new Map();

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

    // Cancel all active ROS goals
    this.activeGoals.forEach((goal) => {
      goal.cancel();
    });
    this.activeGoals.clear();

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
   * Execute ROS action node
   */
  private async executeActionNode(node: BehaviorTreeNode): Promise<ExecutionStatus> {
    const data = node.data as ROSActionNodeData;
    
    return new Promise((resolve) => {
      try {
        const actionClient = new ROSLIB.ActionClient({
          ros: this.ros,
          serverName: data.actionName,
          actionName: data.actionType || data.actionName.split('/').pop() || 'Action',
        });

        const goal = new ROSLIB.Goal({
          actionClient,
          goalMessage: data.parameters || {},
        });

        this.activeGoals.set(node.id, goal);

        goal.on('feedback', () => {
          // Action is running
          this.setNodeStatus(node.id, ExecutionStatus.Running);
        });

        goal.on('result', (result) => {
          this.activeGoals.delete(node.id);
          // Assume success if we got a result
          resolve(ExecutionStatus.Success);
        });

        goal.on('timeout', () => {
          this.activeGoals.delete(node.id);
          resolve(ExecutionStatus.Failure);
        });

        // Set timeout if specified
        const timeout = data.timeout || 30000; // Default 30 seconds
        const timeoutId = setTimeout(() => {
          goal.cancel();
          this.activeGoals.delete(node.id);
          resolve(ExecutionStatus.Failure);
        }, timeout);

        goal.send();

        // Clear timeout on completion
        goal.on('result', () => clearTimeout(timeoutId));
        goal.on('timeout', () => clearTimeout(timeoutId));
      } catch (error) {
        console.error('Error executing action node:', error);
        resolve(ExecutionStatus.Failure);
      }
    });
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

