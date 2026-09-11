import { describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { runSerializedRosapi } from './rosapiQueue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('runSerializedRosapi', () => {
  it('runs rosapi work sequentially for one ROS connection', async () => {
    const ros = {} as Ros;
    const gate = deferred<string>();
    const order: string[] = [];
    const first = runSerializedRosapi(ros, async () => {
      order.push('first-start');
      const result = await gate.promise;
      order.push('first-end');
      return result;
    });
    const secondTask = vi.fn(async () => {
      order.push('second');
      return 'second';
    });
    const second = runSerializedRosapi(ros, secondTask);

    await Promise.resolve();
    expect(secondTask).not.toHaveBeenCalled();
    gate.resolve('first');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('lets an aborted queued caller stop waiting without overlapping the active request', async () => {
    const ros = {} as Ros;
    const gate = deferred<void>();
    const first = runSerializedRosapi(ros, () => gate.promise);
    const controller = new AbortController();
    const queuedTask = vi.fn(async () => 'queued');
    const queued = runSerializedRosapi(ros, queuedTask, controller.signal);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(queuedTask).not.toHaveBeenCalled();
    gate.resolve();
    await first;
    await Promise.resolve();
    expect(queuedTask).not.toHaveBeenCalled();
  });

  it('releases the queue after a failed request', async () => {
    const ros = {} as Ros;
    await expect(runSerializedRosapi(ros, async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(runSerializedRosapi(ros, async () => 'recovered')).resolves.toBe('recovered');
  });
});
