import ROSLIB, { Ros, Topic } from 'roslib';
import { ACTION_TEMPLATES } from '../actionTemplates';
import { BehaviorTree, ExecutionEvent } from '../types';

export const BT_COMMAND_TOPIC = '/robo_boy/behavior_tree/command';
export const BT_STATUS_TOPIC = '/robo_boy/behavior_tree/status';
export const PERSISTENT_EXECUTION_STORAGE_KEY = 'robo-boy-bt-persistent-execution';

export type PersistentExecutionState = 'idle' | 'running' | 'paused';

export interface PersistentExecutionStatus {
  protocolVersion: 1;
  state: PersistentExecutionState;
  sessionId?: string;
  tree?: BehaviorTree;
  treeName?: string;
  startedAt?: number;
  event?: ExecutionEvent;
  activeNodeId?: string;
  activeNodeLabel?: string;
  blackboard?: Record<string, unknown>;
  nodeStatuses?: Record<string, 'running' | 'success' | 'failure'>;
  error?: string;
}

interface PersistentCommand {
  protocolVersion: 1;
  command: 'start' | 'pause' | 'resume' | 'stop' | 'status';
  sessionId?: string;
  tree?: BehaviorTree;
  requestedAt: number;
}

export const loadPersistentExecutionPreference = (): boolean => {
  try {
    return window.localStorage.getItem(PERSISTENT_EXECUTION_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const savePersistentExecutionPreference = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(PERSISTENT_EXECUTION_STORAGE_KEY, String(enabled));
  } catch {
    // Execution still works when storage is unavailable; the preference simply
    // falls back to off next time.
  }
};

const parseStatus = (message: unknown): PersistentExecutionStatus | null => {
  const data = (message as { data?: unknown } | null)?.data;
  if (typeof data !== 'string') return null;

  try {
    const status = JSON.parse(data) as Partial<PersistentExecutionStatus>;
    if (status.protocolVersion !== 1 || !['idle', 'running', 'paused'].includes(status.state || '')) {
      return null;
    }
    return status as PersistentExecutionStatus;
  } catch {
    return null;
  }
};

const prepareTreeForRunner = (tree: BehaviorTree): BehaviorTree => ({
  ...tree,
  nodes: tree.nodes.map(node => {
    if (node.type === 'subtree' && 'tree' in node.data) {
      return { ...node, data: { ...node.data, tree: prepareTreeForRunner(node.data.tree) } };
    }
    if (node.type !== 'action' || !('actionType' in node.data)) return node;
    if (node.data.parameters && Object.keys(node.data.parameters).length > 0) return node;
    return {
      ...node,
      data: {
        ...node.data,
        parameters: structuredClone(ACTION_TEMPLATES[node.data.actionType] || {}),
      },
    };
  }),
});

const createSessionId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `bt-${suffix}`;
};

/** Thin ROS transport for the backend-owned behavior-tree runner. */
export class PersistentBehaviorTreeExecutor {
  private readonly commandTopic: Topic;
  private readonly statusTopic: Topic;
  private readonly listeners = new Set<(status: PersistentExecutionStatus) => void>();
  private subscribed = false;

  constructor(ros: Ros) {
    this.commandTopic = new ROSLIB.Topic({
      ros,
      name: BT_COMMAND_TOPIC,
      messageType: 'std_msgs/msg/String',
    });
    this.statusTopic = new ROSLIB.Topic({
      ros,
      name: BT_STATUS_TOPIC,
      messageType: 'std_msgs/msg/String',
    });
  }

  subscribe(listener: (status: PersistentExecutionStatus) => void): () => void {
    this.listeners.add(listener);
    if (!this.subscribed) {
      this.statusTopic.subscribe(this.handleStatus);
      this.subscribed = true;
      this.send({ command: 'status' });
    }

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.dispose();
    };
  }

  start(tree: BehaviorTree): string {
    const sessionId = createSessionId();
    this.send({ command: 'start', sessionId, tree: prepareTreeForRunner(tree) });
    return sessionId;
  }

  pause(sessionId?: string): void {
    this.send({ command: 'pause', sessionId });
  }
  resume(sessionId?: string): void {
    this.send({ command: 'resume', sessionId });
  }
  stop(sessionId?: string): void {
    this.send({ command: 'stop', sessionId });
  }
  requestStatus(): void {
    this.send({ command: 'status' });
  }

  dispose(): void {
    if (this.subscribed) this.statusTopic.unsubscribe();
    this.subscribed = false;
    this.listeners.clear();
    this.commandTopic.unadvertise();
  }

  private readonly handleStatus = (message: unknown): void => {
    const status = parseStatus(message);
    if (status) this.listeners.forEach(listener => listener(status));
  };

  private send(command: Omit<PersistentCommand, 'protocolVersion' | 'requestedAt'>): void {
    const payload: PersistentCommand = { protocolVersion: 1, requestedAt: Date.now(), ...command };
    this.commandTopic.publish(new ROSLIB.Message({ data: JSON.stringify(payload) }));
  }
}
