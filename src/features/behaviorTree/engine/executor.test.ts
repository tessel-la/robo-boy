import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

import { BehaviorTreeExecutor } from './executor';
import {
  BehaviorNodeType,
  BehaviorTree,
  BehaviorTreeNode,
  ExecutionEvent,
  ExecutionStatus,
} from '../types';

const roslibMocks = vi.hoisted(() => ({
  serviceOutcomes: [] as Array<'success' | 'failure'>,
  serviceCall: vi.fn(),
  topicPublish: vi.fn(),
  topicUnadvertise: vi.fn(),
  topicSubscribe: vi.fn(),
  topicUnsubscribe: vi.fn(),
}));

vi.mock('roslib', () => ({
  default: {
    Service: vi.fn(function () {
      return {
        callService: roslibMocks.serviceCall,
      };
    }),
    ServiceRequest: vi.fn(function (value: Record<string, unknown>) {
      return value;
    }),
    Topic: vi.fn(function () {
      return {
        publish: roslibMocks.topicPublish,
        unadvertise: roslibMocks.topicUnadvertise,
        subscribe: roslibMocks.topicSubscribe,
        unsubscribe: roslibMocks.topicUnsubscribe,
      };
    }),
    Message: vi.fn(function (value: Record<string, unknown>) {
      return value;
    }),
  },
}));

const controlNode = (
  id: string,
  type: BehaviorNodeType.Retry | BehaviorNodeType.Repeat,
  iterationLimit: number
): BehaviorTreeNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    label: type === BehaviorNodeType.Retry ? 'Retry' : 'Repeat',
    type: type === BehaviorNodeType.Retry ? 'retry' : 'repeat',
    iterationLimit,
  },
});

const serviceNode = (id = 'service'): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Service,
  position: { x: 0, y: 100 },
  data: {
    label: 'Service',
    serviceName: '/do_work',
    serviceType: 'example/srv/DoWork',
  },
});

const topicNode = (id = 'topic'): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Topic,
  position: { x: 0, y: 100 },
  data: {
    label: 'Topic',
    topicName: '/cmd',
    messageType: 'example/msg/Cmd',
    message: { value: true },
  },
});

const treeWithControl = (root: BehaviorTreeNode, child: BehaviorTreeNode): BehaviorTree => ({
  id: 'tree',
  name: 'Tree',
  nodes: [root, child],
  edges: [{ id: 'edge-root-child', source: root.id, target: child.id }],
  createdAt: 1,
  updatedAt: 1,
});

const sequenceTree = (): BehaviorTree => ({
  id: 'sequence-tree',
  name: 'Sequence Tree',
  nodes: [
    {
      id: 'sequence',
      type: BehaviorNodeType.Sequence,
      position: { x: 0, y: 0 },
      data: { label: 'Sequence', type: 'sequence' },
    },
    topicNode('topic-one'),
    topicNode('topic-two'),
  ],
  edges: [
    { id: 'edge-one', source: 'sequence', target: 'topic-one' },
    { id: 'edge-two', source: 'sequence', target: 'topic-two' },
  ],
  createdAt: 1,
  updatedAt: 1,
});

const executeTree = async (tree: BehaviorTree) => {
  const events: ExecutionEvent[] = [];
  const executor = new BehaviorTreeExecutor(tree, {} as Ros, (event) => {
    events.push(event);
  });

  await executor.start();
  return events;
};

describe('BehaviorTreeExecutor retry and repeat nodes', () => {
  beforeEach(() => {
    roslibMocks.serviceOutcomes = [];
    roslibMocks.serviceCall.mockReset();
    roslibMocks.serviceCall.mockImplementation(
      (_request: unknown, onSuccess: (result: unknown) => void, onFailure: (error: unknown) => void) => {
        const outcome = roslibMocks.serviceOutcomes.shift() ?? 'success';
        if (outcome === 'success') {
          onSuccess({});
        } else {
          onFailure('failed');
        }
      }
    );
    roslibMocks.topicPublish.mockReset();
    roslibMocks.topicUnadvertise.mockReset();
  });

  it('retries child execution until it succeeds within the configured limit', async () => {
    roslibMocks.serviceOutcomes = ['failure', 'failure', 'success'];

    const events = await executeTree(
      treeWithControl(controlNode('retry', BehaviorNodeType.Retry, 3), serviceNode())
    );

    expect(roslibMocks.serviceCall).toHaveBeenCalledTimes(3);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Success },
    });
  });

  it('fails retry when the configured attempt count is exhausted', async () => {
    roslibMocks.serviceOutcomes = ['failure', 'failure', 'success'];

    const events = await executeTree(
      treeWithControl(controlNode('retry', BehaviorNodeType.Retry, 2), serviceNode())
    );

    expect(roslibMocks.serviceCall).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Failure },
    });
  });

  it('treats -1 retry as unbounded until a child succeeds', async () => {
    roslibMocks.serviceOutcomes = ['failure', 'failure', 'failure', 'failure', 'success'];

    const events = await executeTree(
      treeWithControl(controlNode('retry', BehaviorNodeType.Retry, -1), serviceNode())
    );

    expect(roslibMocks.serviceCall).toHaveBeenCalledTimes(5);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Success },
    });
  });

  it('repeats successful children the configured number of times', async () => {
    const events = await executeTree(
      treeWithControl(controlNode('repeat', BehaviorNodeType.Repeat, 3), topicNode())
    );

    expect(roslibMocks.topicPublish).toHaveBeenCalledTimes(3);
    expect(roslibMocks.topicUnadvertise).toHaveBeenCalledTimes(3);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Success },
    });
  });

  it('fails repeat immediately when a child fails', async () => {
    roslibMocks.serviceOutcomes = ['success', 'failure', 'success'];

    const events = await executeTree(
      treeWithControl(controlNode('repeat', BehaviorNodeType.Repeat, 3), serviceNode())
    );

    expect(roslibMocks.serviceCall).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Failure },
    });
  });

  it('treats -1 repeat as unbounded until a child fails', async () => {
    roslibMocks.serviceOutcomes = ['success', 'success', 'success', 'failure'];

    const events = await executeTree(
      treeWithControl(controlNode('repeat', BehaviorNodeType.Repeat, -1), serviceNode())
    );

    expect(roslibMocks.serviceCall).toHaveBeenCalledTimes(4);
    expect(events[events.length - 1]).toMatchObject({
      type: 'completed',
      data: { result: ExecutionStatus.Failure },
    });
  });
});

describe('BehaviorTreeExecutor pause and resume', () => {
  beforeEach(() => {
    roslibMocks.topicPublish.mockReset();
    roslibMocks.topicUnadvertise.mockReset();
  });

  it('does not advance to the next node until resumed', async () => {
    const events: ExecutionEvent[] = [];
    let executor!: BehaviorTreeExecutor;
    executor = new BehaviorTreeExecutor(sequenceTree(), {} as Ros, (event) => {
      events.push(event);
      if (event.type === 'nodeSuccess' && event.nodeId === 'topic-one') executor.pause();
    });

    const execution = executor.start();
    await vi.waitFor(() => expect(roslibMocks.topicPublish).toHaveBeenCalledTimes(1));
    expect(events.some((event) => event.type === 'paused')).toBe(true);

    executor.resume();
    await execution;

    expect(roslibMocks.topicPublish).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === 'resumed')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'completed' });
  });

  it('stops cleanly while paused without advancing', async () => {
    const events: ExecutionEvent[] = [];
    let executor!: BehaviorTreeExecutor;
    executor = new BehaviorTreeExecutor(sequenceTree(), {} as Ros, (event) => {
      events.push(event);
      if (event.type === 'nodeSuccess' && event.nodeId === 'topic-one') executor.pause();
    });

    const execution = executor.start();
    await vi.waitFor(() => expect(events.some((event) => event.type === 'paused')).toBe(true));
    executor.stop();
    await execution;

    expect(roslibMocks.topicPublish).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'stopped')).toBe(true);
    expect(events.some((event) => event.type === 'completed')).toBe(false);
  });
});

describe('BehaviorTreeExecutor blackboard nodes', () => {
  beforeEach(() => {
    roslibMocks.topicPublish.mockReset();
    roslibMocks.topicSubscribe.mockReset();
    roslibMocks.topicUnsubscribe.mockReset();
  });

  it('captures a subscriber message and publishes a blackboard-bound payload', async () => {
    let subscriber: ((message: unknown) => void) | undefined;
    roslibMocks.topicSubscribe.mockImplementation(callback => { subscriber = callback; });
    const tree: BehaviorTree = {
      id: 'blackboard', name: 'Blackboard', createdAt: 1, updatedAt: 1,
      nodes: [
        { id: 'sequence', type: BehaviorNodeType.Sequence, position: { x: 0, y: 0 }, data: { label: 'Sequence', type: 'sequence' } },
        { id: 'subscriber', type: BehaviorNodeType.Subscriber, position: { x: 0, y: 1 }, data: { label: 'Subscriber', topicName: '/state', messageType: 'example/msg/State', timeout: 1000, outputBindings: [{ sourcePath: 'value', variable: 'state' }] } },
        { id: 'publisher', type: BehaviorNodeType.Topic, position: { x: 0, y: 2 }, data: { label: 'Publisher', topicName: '/command', messageType: 'example/msg/Command', message: { value: 0 }, inputBindings: [{ variable: 'state', targetPath: 'value' }] } },
      ],
      edges: [
        { id: 'one', source: 'sequence', target: 'subscriber' },
        { id: 'two', source: 'sequence', target: 'publisher' },
      ],
    };
    const events: ExecutionEvent[] = [];
    const executor = new BehaviorTreeExecutor(tree, {} as Ros, event => events.push(event));
    const execution = executor.start();
    await vi.waitFor(() => expect(subscriber).toBeTypeOf('function'));
    subscriber?.({ value: 42 });
    await execution;

    expect(roslibMocks.topicUnsubscribe).toHaveBeenCalledOnce();
    expect(roslibMocks.topicPublish).toHaveBeenCalledWith({ value: 42 });
    expect(executor.getBlackboard()).toEqual({ state: 42 });
    expect(events.some(event => event.type === 'blackboardUpdated')).toBe(true);
  });

  it('selects the Then and Else handles using typed comparisons', async () => {
    const makeTree = (value: number): BehaviorTree => ({
      id: `if-${value}`, name: 'If', createdAt: 1, updatedAt: 1, blackboardDefaults: { value },
      nodes: [
        { id: 'if', type: BehaviorNodeType.IfElse, position: { x: 0, y: 0 }, data: { label: 'If', variable: 'value', operator: 'greaterThan', expectedValue: 3 } },
        { ...topicNode('then'), data: { ...topicNode('then').data, message: { branch: 'then' } } },
        { ...topicNode('else'), data: { ...topicNode('else').data, message: { branch: 'else' } } },
      ],
      edges: [
        { id: 'then-edge', source: 'if', sourceHandle: 'then', target: 'then' },
        { id: 'else-edge', source: 'if', sourceHandle: 'else', target: 'else' },
      ],
    });
    await executeTree(makeTree(5));
    await executeTree(makeTree(1));
    expect(roslibMocks.topicPublish.mock.calls.map(([message]) => message.branch)).toEqual(['then', 'else']);
  });
});
