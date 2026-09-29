import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

import { BehaviorTreeExecutor } from './executor';
import { BehaviorNodeType, type BehaviorTree, type BehaviorTreeNode, type ExecutionEvent, ExecutionStatus } from '../types';
import { ExecutionDetailsStore, FEEDBACK_NOTIFY_MS } from '../execution/executionStore';
import { executionKey, type ExecutionUpdate } from '../execution/executionModel';

const serviceMock = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; request: unknown; resolve: (response: unknown) => void; reject: (error: unknown) => void }>,
}));

vi.mock('roslib', () => ({
  default: {
    Service: vi.fn(function Service(this: { name: string }, options: { name: string }) {
      return {
        callService: (request: unknown, resolve: (response: unknown) => void, reject: (error: unknown) => void) => {
          serviceMock.calls.push({ name: options.name, request, resolve, reject });
        },
      };
    }),
    ServiceRequest: vi.fn(function ServiceRequest(value: Record<string, unknown>) { return value; }),
    Topic: vi.fn(),
    Message: vi.fn(function Message(value: Record<string, unknown>) { return value; }),
  },
}));

vi.mock('../services/rosDiscovery', () => ({ fetchActionGoalDetails: vi.fn(async () => null) }));

/** A rosbridge connection whose socket the test speaks for, and which records what the executor sends. */
function createRos() {
  const sent: Array<Record<string, any>> = [];
  const listeners = new Map<string, Set<() => void>>();
  const socket: { onmessage: ((event: { data: string }) => void) | null } = { onmessage: () => {} };
  const ros = {
    isConnected: true,
    socket,
    callOnConnection: (message: Record<string, any>) => sent.push(message),
    on: (event: string, listener: () => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
  };
  return {
    ros: ros as unknown as Ros,
    raw: ros,
    sent,
    goals: () => sent.filter(message => message.op === 'send_action_goal'),
    receive: (message: Record<string, unknown>) => socket.onmessage?.({ data: JSON.stringify(message) }),
    close: () => {
      ros.isConnected = false;
      listeners.get('close')?.forEach(listener => listener());
    },
  };
}

const actionNode = (id = 'capture', timeout?: number): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Action,
  position: { x: 0, y: 0 },
  data: {
    label: 'Capture',
    actionName: '/camera/capture',
    actionType: 'robot_msgs/action/Capture',
    parameters: { exposure: 10 },
    timeout,
  },
});

const serviceNode = (id = 'snapshot', timeout?: number): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Service,
  position: { x: 0, y: 0 },
  data: { label: 'Snapshot', serviceName: '/camera/snapshot', serviceType: 'robot_msgs/srv/Snapshot', timeout },
});

const single = (node: BehaviorTreeNode): BehaviorTree => ({
  id: 'tree', name: 'Tree', nodes: [node], edges: [], createdAt: 1, updatedAt: 1,
});

const repeated = (node: BehaviorTreeNode, times: number): BehaviorTree => ({
  id: 'tree',
  name: 'Tree',
  nodes: [
    { id: 'repeat', type: BehaviorNodeType.Repeat, position: { x: 0, y: 0 }, data: { label: 'Repeat', type: 'repeat', iterationLimit: times } },
    node,
  ],
  edges: [{ id: 'e', source: 'repeat', target: node.id }],
  createdAt: 1,
  updatedAt: 1,
});

/** Runs a tree the way the panel does: executions go into a store, as the panel's event handler puts them. */
function run(tree: BehaviorTree, connection = createRos()) {
  const store = new ExecutionDetailsStore();
  const events: ExecutionEvent[] = [];
  const executor = new BehaviorTreeExecutor(tree, connection.ros, event => {
    events.push(event);
    if (event.type === 'nodeExecution' && event.nodeId) {
      store.apply(event.nodeId, (event.data?.treePath as string[]) ?? [], event.data?.execution as ExecutionUpdate);
    }
  });
  const done = executor.start();
  const record = (nodeId: string) => store.get(executionKey(nodeId, []));
  const summary = (nodeId: string) => store.summary(executionKey(nodeId, []));
  const status = (nodeId: string) => [...events].reverse().find(event => event.nodeId === nodeId && event.data?.status)?.data?.status;
  return { executor, store, events, done, record, summary, status, connection };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const lastGoalId = (connection: ReturnType<typeof createRos>) => connection.goals()[connection.goals().length - 1].id as string;

describe('execution details from actions and services', () => {
  beforeEach(() => {
    serviceMock.calls = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps an action\'s result, text included', async () => {
    const run1 = run(single(actionNode()));
    await flush();
    const goal = run1.connection.goals()[0];
    expect(goal).toMatchObject({ action: '/camera/capture', action_type: 'robot_msgs/action/Capture', feedback: true });
    expect(run1.record('capture')).toMatchObject({ phase: 'running', kind: 'action', hasResult: false });

    run1.connection.receive({ op: 'action_result', id: goal.id, status: 4, result: true, values: { summary: 'Captured 1 frame' } });
    await run1.done;

    expect(run1.status('capture')).toBe(ExecutionStatus.Success);
    expect(run1.record('capture')).toMatchObject({ phase: 'succeeded', goalStatus: 4, result: { summary: 'Captured 1 frame' } });
    expect(run1.summary('capture')).toMatchObject({ tone: 'success', hasDetails: true, hasImage: false });
  });

  it('has nothing to show for an action that succeeds without a result', async () => {
    const { connection, done, record, summary } = run(single(actionNode()));
    await flush();
    connection.receive({ op: 'action_result', id: lastGoalId(connection), status: 4, result: true, values: {} });
    await done;
    expect(record('capture')).toMatchObject({ phase: 'succeeded', hasResult: true, result: {} });
    expect(summary('capture')).toMatchObject({ tone: 'success', hasDetails: false });
  });

  it('keeps a structured action result', async () => {
    const { connection, done, record } = run(single(actionNode()));
    await flush();
    const result = { pose: { position: { x: 1, y: 2, z: 0 } }, detections: [{ label: 'crate', score: 0.92 }] };
    connection.receive({ op: 'action_result', id: lastGoalId(connection), status: 4, result: true, values: result });
    await done;
    expect(record('capture')?.result).toEqual(result);
  });

  it('shows feedback as it arrives, without replaying each message to the tree', async () => {
    const { connection, done, record, summary, store } = run(single(actionNode()));
    await flush();
    const listener = vi.fn();
    store.subscribe(executionKey('capture', []), listener);

    connection.receive({ op: 'action_feedback', id: lastGoalId(connection), values: { progress: 0.25 } });
    connection.receive({ op: 'action_feedback', id: lastGoalId(connection), values: { progress: 0.5 } });
    connection.receive({ op: 'action_feedback', id: 'someone-else', values: { progress: 0.99 } });
    expect(record('capture')?.feedback).toMatchObject({ payload: { progress: 0.5 }, count: 2 });
    expect(summary('capture')).toMatchObject({ tone: 'running', label: 'Running · feedback received', hasDetails: true });
    // The first feedback changes the phase label and is told at once; later ones wait for the next notification.
    expect(listener).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, FEEDBACK_NOTIFY_MS + 20));
    expect(listener).toHaveBeenCalledTimes(2);

    connection.receive({ op: 'action_result', id: lastGoalId(connection), status: 4, result: true, values: { done: true } });
    await done;
    expect(record('capture')).toMatchObject({ phase: 'succeeded', feedback: { count: 2 }, result: { done: true } });
  });

  it('explains an action rosbridge could not run', async () => {
    const { connection, done, record, summary, status } = run(single(actionNode()));
    await flush();
    connection.receive({ op: 'action_result', id: lastGoalId(connection), result: false, values: 'Action server /camera/capture is not available' });
    await done;
    expect(status('capture')).toBe(ExecutionStatus.Failure);
    expect(record('capture')).toMatchObject({
      phase: 'failed',
      error: { message: 'Action server /camera/capture is not available', source: 'ros' },
    });
    expect(summary('capture')).toMatchObject({ tone: 'error', hasDetails: true });
  });

  it('keeps the diagnostics of an aborted action', async () => {
    const { connection, done, record, summary } = run(single(actionNode()));
    await flush();
    const values = { error_code: 104, error_msg: 'Lens cover closed', diagnostics: { temperature: 71.5, retries: [1, 2, 3] } };
    connection.receive({ op: 'action_result', id: lastGoalId(connection), status: 6, result: true, values });
    await done;
    expect(record('capture')).toMatchObject({
      phase: 'failed',
      goalStatus: 6,
      result: values,
      error: { message: 'Lens cover closed', code: 104, source: 'ros' },
    });
    expect(summary('capture')?.label).toBe('Aborted');
  });

  it('keeps a service response, a plain value included', async () => {
    const { done, record, summary } = run(single(serviceNode()));
    await flush();
    expect(record('snapshot')).toMatchObject({ phase: 'running', kind: 'service' });
    expect(summary('snapshot')).toMatchObject({ label: 'Calling', hasDetails: false });
    serviceMock.calls[0].resolve({ count: 3 });
    await done;
    expect(record('snapshot')).toMatchObject({ phase: 'succeeded', result: { count: 3 } });
    expect(summary('snapshot')).toMatchObject({ tone: 'success', label: 'Responded', hasDetails: true });
  });

  it('keeps a structured service response', async () => {
    const { done, record } = run(single(serviceNode()));
    await flush();
    const response = { success: true, map: { resolution: 0.05, origin: { x: -10, y: -10 } }, layers: ['static', 'inflation'] };
    serviceMock.calls[0].resolve(response);
    await done;
    expect(record('snapshot')?.result).toEqual(response);
  });

  it('has nothing to show for an empty service response', async () => {
    const { done, summary, status } = run(single(serviceNode()));
    await flush();
    serviceMock.calls[0].resolve({});
    await done;
    expect(status('snapshot')).toBe(ExecutionStatus.Success);
    expect(summary('snapshot')).toMatchObject({ tone: 'success', hasDetails: false });
  });

  it('explains a failed service call', async () => {
    const { done, record, status } = run(single(serviceNode()));
    await flush();
    serviceMock.calls[0].reject('Service /camera/snapshot does not exist');
    await done;
    expect(status('snapshot')).toBe(ExecutionStatus.Failure);
    expect(record('snapshot')).toMatchObject({
      phase: 'failed',
      error: { message: 'Service /camera/snapshot does not exist', source: 'ros' },
    });
  });

  it('flags a response that reports its own failure, without changing the tree\'s outcome', async () => {
    const { done, record, summary, status } = run(single(serviceNode()));
    await flush();
    serviceMock.calls[0].resolve({ success: false, message: 'Camera busy' });
    await done;
    expect(status('snapshot')).toBe(ExecutionStatus.Success);
    expect(record('snapshot')).toMatchObject({ phase: 'succeeded', result: { success: false, message: 'Camera busy' } });
    expect(summary('snapshot')).toMatchObject({ tone: 'warning', label: 'Responded · reported failure', hasDetails: true });
  });

  it('tells a timeout from a lost connection', async () => {
    vi.useFakeTimers();
    const timedOut = run(single(serviceNode('snapshot', 500)));
    await vi.advanceTimersByTimeAsync(600);
    await timedOut.done;
    expect(timedOut.record('snapshot')).toMatchObject({ phase: 'timeout', error: { message: 'No response from /camera/snapshot within 500 ms.', source: 'timeout' } });

    const lost = run(single(serviceNode()));
    await vi.advanceTimersByTimeAsync(10);
    lost.connection.close();
    await lost.done;
    expect(lost.record('snapshot')).toMatchObject({ phase: 'transport', error: { source: 'transport' } });

    // A response that arrives after the call gave up is not the call's.
    lost.store.apply('snapshot', [], { attemptId: lost.record('snapshot')!.attemptId, kind: 'service', target: '/camera/snapshot', phase: 'running' });
    serviceMock.calls[serviceMock.calls.length - 1].resolve({ late: true });
    expect(lost.record('snapshot')?.result).toBeUndefined();
  });

  it('replaces an action\'s previous execution when it runs again, ignoring the old goal\'s messages', async () => {
    const { connection, done, record } = run(repeated(actionNode(), 2));
    await flush();
    const first = lastGoalId(connection);
    connection.receive({ op: 'action_feedback', id: first, values: { progress: 1 } });
    connection.receive({ op: 'action_result', id: first, status: 4, result: true, values: { frame: 1 } });
    await flush();
    await flush();

    const second = lastGoalId(connection);
    expect(second).not.toBe(first);
    expect(record('capture')).toMatchObject({ attemptId: second, phase: 'running', hasResult: false });
    expect(record('capture')?.feedback).toBeUndefined();

    connection.receive({ op: 'action_result', id: first, status: 6, result: true, values: { frame: 'stale' } });
    expect(record('capture')).toMatchObject({ attemptId: second, phase: 'running' });

    connection.receive({ op: 'action_result', id: second, status: 4, result: true, values: { frame: 2 } });
    await done;
    expect(record('capture')).toMatchObject({ attemptId: second, result: { frame: 2 } });
  });

  it('replaces a service\'s previous response when it is called again', async () => {
    const { done, record } = run(repeated(serviceNode(), 2));
    await flush();
    serviceMock.calls[0].resolve({ frame: 1 });
    await flush();
    await flush();
    expect(serviceMock.calls).toHaveLength(2);
    expect(record('snapshot')).toMatchObject({ phase: 'running', hasResult: false });
    serviceMock.calls[1].reject('Camera disconnected');
    await done;
    expect(record('snapshot')).toMatchObject({ phase: 'failed', hasResult: false, error: { message: 'Camera disconnected' } });
  });

  it('cancels an action when the tree stops, leaving no result behind', async () => {
    const { connection, done, record, summary, executor } = run(single(actionNode()));
    await flush();
    const goal = lastGoalId(connection);
    connection.receive({ op: 'action_feedback', id: goal, values: { progress: 0.4 } });
    executor.stop();
    await done;

    expect(connection.sent).toContainEqual(expect.objectContaining({ op: 'cancel_action_goal', id: goal }));
    expect(record('capture')).toMatchObject({ phase: 'cancelled', hasResult: false, error: { source: 'stopped' } });
    // A tree the operator stopped is not news, but the feedback received before is still there to look at.
    expect(summary('capture')).toMatchObject({ tone: 'neutral', hasDetails: false });

    // The server's own report of the cancellation comes after the goal was let go.
    connection.receive({ op: 'action_result', id: goal, status: 5, result: true, values: {} });
    expect(record('capture')).toMatchObject({ phase: 'cancelled', hasResult: false });
  });

  it('starts every run, reload and connection with nothing from before', async () => {
    const { connection, done, record, store } = run(single(actionNode()));
    await flush();
    connection.receive({ op: 'action_result', id: lastGoalId(connection), status: 4, result: true, values: { frame: 1 } });
    await done;
    expect(record('capture')).toBeDefined();

    // Reconnecting: whatever still ran ended with the connection.
    store.apply('capture', [], { attemptId: 'again', kind: 'action', target: '/camera/capture', phase: 'running', begin: true });
    store.interruptRunning('The connection to ROS was lost.');
    expect(record('capture')).toMatchObject({ attemptId: 'again', phase: 'transport' });

    // A new run or another tree: nothing is left.
    store.clear();
    expect(record('capture')).toBeUndefined();
    expect(store.summary(executionKey('capture', []))).toBeUndefined();
  });

  it('keeps subtree executions apart from root ones with the same node id', () => {
    const store = new ExecutionDetailsStore();
    store.apply('n1', [], { attemptId: 'a', kind: 'service', target: '/root', phase: 'succeeded', result: { at: 'root' } });
    store.apply('n1', ['sub'], { attemptId: 'b', kind: 'service', target: '/sub', phase: 'succeeded', result: { at: 'sub' } });
    expect(store.get(executionKey('n1', []))?.result).toEqual({ at: 'root' });
    expect(store.get(executionKey('n1', ['sub']))?.result).toEqual({ at: 'sub' });
  });

  it('notices an image in a result', async () => {
    const { connection, done, summary } = run(single(actionNode()));
    await flush();
    connection.receive({
      op: 'action_result',
      id: lastGoalId(connection),
      status: 4,
      result: true,
      values: { image: { header: {}, format: 'jpeg', data: '/9j/4AAQSkZJRgABAQAAAQABAAD'.padEnd(200, 'A') } },
    });
    await done;
    expect(summary('capture')).toMatchObject({ hasImage: true, hasDetails: true });
  });
});
