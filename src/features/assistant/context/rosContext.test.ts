import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

const state = vi.hoisted(() => ({
  topics: [] as Array<{ callback?: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }>,
}));

vi.mock('roslib', () => {
  class Topic {
    callback?: (message: unknown) => void;
    unsubscribe = vi.fn();
    constructor() { state.topics.push(this); }
    subscribe(callback: (message: unknown) => void) { this.callback = callback; }
  }
  class Param {
    get(callback: (value: unknown) => void) { callback('value'); }
  }
  return { default: { Topic, Param }, Topic, Param, Ros: class {} };
});

import { sampleRosTopic } from './rosContext';

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
