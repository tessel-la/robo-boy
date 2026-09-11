import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

const state = vi.hoisted(() => ({
  topics: [] as Array<{ callback?: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }>,
  param: ((_name: string, resolve: (value: unknown) => void) => resolve('value')) as (
    name: string,
    resolve: (value: unknown) => void,
    reject?: (error: unknown) => void
  ) => void,
}));

vi.mock('roslib', () => {
  class Topic {
    callback?: (message: unknown) => void;
    unsubscribe = vi.fn();
    constructor() { state.topics.push(this); }
    subscribe(callback: (message: unknown) => void) { this.callback = callback; }
  }
  class Param {
    name: string;
    constructor(options: { name: string }) { this.name = options.name; }
    get(callback: (value: unknown) => void, failed?: (error: unknown) => void) { state.param(this.name, callback, failed); }
  }
  return { default: { Topic, Param }, Topic, Param, Ros: class {} };
});

import {
  captureRosout,
  fetchRosNodeDetails,
  fetchRosNodeNames,
  fetchRosParameterNames,
  fetchRosParameterValue,
  sampleRosTopic,
} from './rosContext';

describe('assistant ROS topic sampling', () => {
  beforeEach(() => {
    state.topics.length = 0;
  });

  it('stops after the bounded message count and unsubscribes', async () => {
    const resultPromise = sampleRosTopic({} as Ros, '/status', 'std_msgs/msg/String', { maxMessages: 2, timeoutMs: 500 });
    state.topics[0].callback?.({ data: 'one' });
    state.topics[0].callback?.({ data: 'two' });
    state.topics[0].callback?.({ data: 'ignored' });
    const result = await resultPromise;
    expect(result.samples.map(item => item.value)).toEqual([{ data: 'one' }, { data: 'two' }]);
    expect(result.limits.maxMessages).toBe(2);
    expect(state.topics[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('truncates an oversized sample instead of retaining it in full', async () => {
    const resultPromise = sampleRosTopic({} as Ros, '/image', 'sensor_msgs/msg/Image', { maxMessages: 1, timeoutMs: 500 });
    state.topics[0].callback?.({ data: 'x'.repeat(30 * 1024) });
    const result = await resultPromise;
    expect(result.samples[0].value).toMatchObject({ truncated: true });
  });

  it('times out with the samples received so far', async () => {
    const result = await sampleRosTopic({} as Ros, '/quiet', 'std_msgs/msg/String', { timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(result.samples).toEqual([]);
    expect(state.topics[0].unsubscribe).toHaveBeenCalledOnce();
  });

  it('cancels and unsubscribes', async () => {
    const controller = new AbortController();
    const resultPromise = sampleRosTopic({} as Ros, '/status', 'std_msgs/msg/String', { signal: controller.signal });
    controller.abort();
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.topics[0].unsubscribe).toHaveBeenCalledOnce();
  });
});

/**
 * These are the rosapi lookups behind `@node` and `@parameter` tags. Their caps and their handling
 * of a rosapi deployment that answers with something other than a list are what keep a tag from
 * putting an unbounded or malformed blob into the prompt.
 */
describe('assistant rosapi lookups', () => {
  const rosWith = (methods: Record<string, unknown>) => methods as unknown as Ros;

  beforeEach(() => {
    state.topics.length = 0;
  });

  it('caps node, parameter and node-detail lists at 250 entries and stringifies them', async () => {
    const many = Array.from({ length: 400 }, (_, index) => index);
    const ros = rosWith({
      getNodes: (resolve: (value: unknown) => void) => resolve(many),
      getParams: (resolve: (value: unknown) => void) => resolve(many),
      getNodeDetails: (_node: string, resolve: (a: unknown, b: unknown, c: unknown) => void) => resolve(many, many, many),
    });

    await expect(fetchRosNodeNames(ros)).resolves.toHaveLength(250);
    await expect(fetchRosParameterNames(ros)).resolves.toEqual(many.slice(0, 250).map(String));
    const details = await fetchRosNodeDetails(ros, '/driver');
    expect(details).toMatchObject({ node: '/driver' });
    expect([details.subscribing, details.publishing, details.services].map(list => list.length)).toEqual([250, 250, 250]);
  });

  it.each([
    ['getNodes', () => fetchRosNodeNames(rosWith({ getNodes: (resolve: (v: unknown) => void) => resolve({ oops: true }) }))],
    ['getParams', () => fetchRosParameterNames(rosWith({ getParams: (resolve: (v: unknown) => void) => resolve(null) }))],
  ])('treats a non-list %s answer as empty rather than crashing the picker', async (_name, call) => {
    await expect(call()).resolves.toEqual([]);
  });

  it('reports empty lists for a node whose details come back malformed', async () => {
    const ros = rosWith({
      getNodeDetails: (_node: string, resolve: (a: unknown, b: unknown, c: unknown) => void) => resolve(undefined, 'nope', 7),
    });

    await expect(fetchRosNodeDetails(ros, '/driver')).resolves.toEqual({
      node: '/driver',
      subscribing: [],
      publishing: [],
      services: [],
    });
  });

  it('propagates a rosapi failure so the assistant can say the call did not answer', async () => {
    const ros = rosWith({ getNodes: (_resolve: unknown, reject: (error: unknown) => void) => reject(new Error('service unavailable')) });

    await expect(fetchRosNodeNames(ros)).rejects.toThrow('service unavailable');
  });

  it('turns a thrown rosapi call into a rejection instead of an unhandled error', async () => {
    const ros = rosWith({ getNodes: () => { throw new Error('rosapi is not running'); } });

    await expect(fetchRosNodeNames(ros)).rejects.toThrow('rosapi is not running');
  });

  it('does not call rosapi at all when the request is already cancelled', async () => {
    const getNodes = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(fetchRosNodeNames(rosWith({ getNodes }), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getNodes).not.toHaveBeenCalled();
  });

  it('bounds a parameter value, so one huge parameter cannot fill the prompt', async () => {
    state.param = (_name, resolve) => resolve({ blob: 'x'.repeat(30 * 1024) });

    await expect(fetchRosParameterValue({} as Ros, '/big')).resolves.toMatchObject({ truncated: true });

    state.param = (_name, resolve) => resolve({ small: true });
    await expect(fetchRosParameterValue({} as Ros, '/small')).resolves.toEqual({ small: true });
  });

  it('captures /rosout to the 40 messages the picker promises, not the 3-message default', async () => {
    const capture = captureRosout({} as Ros);
    for (let index = 0; index < 41; index += 1) state.topics[0].callback?.({ msg: `line ${index}` });
    const result = await capture;

    expect(result.topic).toBe('/rosout');
    expect(result.messageType).toBe('rcl_interfaces/msg/Log');
    expect(result.limits).toMatchObject({ maxMessages: 40, timeoutMs: 4000 });
    expect(result.samples).toHaveLength(40);
    expect(result.timedOut).toBe(false);
  });

  it('still samples a plain topic tag at the small default', async () => {
    const sample = sampleRosTopic({} as Ros, '/odom', 'nav_msgs/msg/Odometry', {});
    for (let index = 0; index < 5; index += 1) state.topics[0].callback?.({ index });
    await expect(sample).resolves.toMatchObject({ limits: { maxMessages: 3 } });
  });
});
