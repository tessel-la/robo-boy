import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';

const topicState = vi.hoisted(() => ({
  instances: [] as Array<{ name: string; callback?: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }>,
}));

vi.mock('roslib', () => {
  class Topic {
    name: string;
    callback?: (message: unknown) => void;
    unsubscribe = vi.fn();
    constructor(options: { name: string }) {
      this.name = options.name;
      topicState.instances.push(this);
    }
    subscribe(callback: (message: unknown) => void) {
      this.callback = callback;
    }
  }
  return { default: { Topic }, Topic, Ros: class {} };
});

import { lookupTransformOnDemand, parseDistanceRequest, parseTransformRequest } from './tfContext';

const transform = (parent: string, child: string, x: number) => ({
  header: { frame_id: parent, stamp: { sec: 1, nanosec: 0 } },
  child_frame_id: child,
  transform: { translation: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
});

describe('assistant TF context', () => {
  beforeEach(() => {
    topicState.instances.length = 0;
  });

  it('parses btw phrasing and preserves human-spaced frame hints', () => {
    expect(parseTransformRequest('what is the transform btw panda link 0 and panda hand')).toEqual({
      sourceFrame: 'panda link 0',
      targetFrame: 'panda hand',
    });
    expect(parseDistanceRequest('compute distance btw panda link 0 and panda hand')).toEqual({
      sourceFrame: 'panda link 0',
      targetFrame: 'panda hand',
    });
  });

  it('resolves spaced names and calculates a multi-hop transform', async () => {
    const resultPromise = lookupTransformOnDemand({} as Ros, 'panda link 0', 'panda hand', 500);
    topicState.instances.find(item => item.name === '/tf_static')?.callback?.({
      transforms: [transform('panda_link0', 'panda_link1', 0.4), transform('panda_link1', 'panda_hand', 0.2)],
    });
    const result = await resultPromise;
    expect(result.resolvedSource).toBe('panda_link0');
    expect(result.resolvedTarget).toBe('panda_hand');
    expect(result.transform?.translation.x).toBeCloseTo(0.6);
    expect(result.transform?.path).toEqual(['panda_link0', 'panda_link1', 'panda_hand']);
    expect(topicState.instances.every(item => item.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('returns bounded diagnostics on timeout and unsubscribes', async () => {
    const resultPromise = lookupTransformOnDemand({} as Ros, 'base', 'camera', 10);
    topicState.instances.find(item => item.name === '/tf')?.callback?.({
      transforms: [transform('base', 'arm', 1), transform('map', 'camera', 2)],
    });
    const result = await resultPromise;
    expect(result.transform).toBeNull();
    expect(result.timedOut).toBe(true);
    expect(result.diagnostics.components).toHaveLength(2);
    expect(topicState.instances.every(item => item.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('aborts and unsubscribes both temporary subscriptions', async () => {
    const controller = new AbortController();
    const resultPromise = lookupTransformOnDemand({} as Ros, 'base', 'tool', 500, controller.signal);
    controller.abort();
    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(topicState.instances.every(item => item.unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});
