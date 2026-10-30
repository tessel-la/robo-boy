import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { subscribeCloudini } from './cloudiniStreams';
import fixture from '../../../e2e/fixtures/cloudini-v6.json';
const frame = (sec: number) => ({ ...fixture, header: { frame_id: 'laser', stamp: { sec, nanosec: 0 } } });

const subscriptions = vi.hoisted(
  () => [] as { receive?: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }[]
);
vi.mock('roslib', () => ({
  Topic: vi.fn(function () {
    const topic = {
      receive: undefined as ((message: unknown) => void) | undefined,
      unsubscribe: vi.fn(),
      subscribe(callback: (message: unknown) => void) {
        this.receive = callback;
      },
    };
    subscriptions.push(topic);
    return topic;
  }),
}));

class TestWorker {
  static instances: TestWorker[] = [];
  postMessage = vi.fn();
  terminate = vi.fn();
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  constructor() {
    TestWorker.instances.push(this);
  }
}

describe('shared compressed point-cloud streams', () => {
  const cleanup: (() => void)[] = [];
  beforeEach(() => {
    subscriptions.length = 0;
    TestWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', TestWorker);
  });
  afterEach(() => {
    cleanup.splice(0).forEach(stop => stop());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('shares a worker/subscription, bounds pending work, and releases it after the last consumer', () => {
    const ros = {} as Ros;
    const first = vi.fn(),
      second = vi.fn();
    const stopFirst = subscribeCloudini(ros, '/cloud', first);
    cleanup.push(stopFirst, subscribeCloudini(ros, '/cloud', second));
    expect(subscriptions).toHaveLength(1);
    expect(TestWorker.instances).toHaveLength(0);
    subscriptions[0].receive?.(frame(1));
    subscriptions[0].receive?.(frame(2));
    subscriptions[0].receive?.(frame(3));
    const worker = TestWorker.instances[0];
    expect(worker.postMessage.mock.calls.map(([message]) => message.header.stamp.sec)).toEqual([1]);
    worker.onmessage?.({ data: { message: { frame: 1 } } });
    expect(worker.postMessage.mock.calls.map(([message]) => message.header.stamp.sec)).toEqual([1, 3]);
    stopFirst();
    stopFirst();
    expect(worker.terminate).not.toHaveBeenCalled();
    cleanup[1]();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    const calls = second.mock.calls.length;
    worker.onmessage?.({ data: { message: { frame: 9 } } });
    expect(second).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('isolates connections and replaces a stalled worker without accepting its late results', () => {
    const listener = vi.fn();
    cleanup.push(subscribeCloudini({} as Ros, '/cloud', listener));
    cleanup.push(subscribeCloudini({} as Ros, '/cloud', vi.fn()));
    expect(subscriptions).toHaveLength(2);
    subscriptions[0].receive?.(frame(1));
    subscriptions[0].receive?.(frame(2));
    const old = TestWorker.instances[0];
    vi.advanceTimersByTime(5000);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenLastCalledWith({ error: 'Point-cloud decoding timed out.' });
    expect(TestWorker.instances).toHaveLength(2);
    const count = listener.mock.calls.length;
    old.onmessage?.({ data: { message: { stale: true } } });
    expect(listener).toHaveBeenCalledTimes(count);
    TestWorker.instances[1].onmessage?.({ data: { error: 'Invalid payload' } });
    expect(listener).toHaveBeenLastCalledWith({ error: 'Invalid payload' });
  });
  it('rejects oversized packets before cloning them into a worker', () => {
    const listener = vi.fn();
    cleanup.push(subscribeCloudini({} as Ros, '/cloud', listener));
    subscriptions[0].receive?.({ ...frame(1), compressed_data: new Uint8Array(8 * 1024 * 1024 + 1) });
    expect(listener).toHaveBeenLastCalledWith({ error: 'Compressed point cloud exceeds 8 MiB.' });
    expect(TestWorker.instances).toHaveLength(0);
  });
});
