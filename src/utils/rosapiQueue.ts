import type { Ros } from 'roslib';

const queueTails = new WeakMap<object, Promise<void>>();

const abortError = () => new DOMException('ROS context request cancelled.', 'AbortError');

/**
 * rosapi creates ROS service clients internally. On ROS 2, overlapping those calls can contend on
 * rosbridge's rclpy node and disconnect the websocket. This queue is shared by every Robo-Boy
 * rosapi caller that performs graph or schema introspection, so serialization is an invariant of
 * the transport boundary rather than an accident of one feature.
 *
 * Aborting stops a queued task before it starts and lets the caller stop waiting immediately. A
 * service call already handed to rosbridge cannot be cancelled, so it remains at the head of the
 * queue until its callback settles; its result is then discarded by the caller's generation guard.
 */
export const runSerializedRosapi = async <T>(ros: Ros, task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (signal?.aborted) throw abortError();

  const previous = queueTails.get(ros as object) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw abortError();
    return task();
  });
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  queueTails.set(ros as object, tail);

  let removeAbortListener: () => void = () => undefined;
  const result = signal
    ? Promise.race([
        run,
        new Promise<never>((_, reject) => {
          const onAbort = () => reject(abortError());
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener('abort', onAbort);
        }),
      ])
    : run;

  try {
    return await result;
  } finally {
    removeAbortListener();
    void tail.finally(() => {
      if (queueTails.get(ros as object) === tail) queueTails.delete(ros as object);
    });
  }
};
