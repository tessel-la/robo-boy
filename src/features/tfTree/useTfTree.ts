import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import type { Ros } from 'roslib';

import { TfSource, TfTreeState, consumeTfMessage, createEmptyTfTreeState, detectClockReset } from './tfTreeModel';

interface UseTfTreeResult {
  state: TfTreeState;
  /** Forgets every transform and subscribes again, so latched static transforms are re-sent and
   * frames that stopped existing disappear. */
  refresh: () => void;
}

/**
 * Keeps the TF tree from `/tf` and `/tf_static`. The tree resets itself whenever the source does:
 * a new ROS connection, or a publisher whose stamps jump backwards (a simulator restart) — in
 * both cases what was collected before describes a robot that is gone. A static transform whose
 * publisher simply died cannot be noticed from the browser (latched topics send no retraction),
 * which is what the manual refresh is still for.
 */
export const useTfTree = (ros: Ros | null, isActive = true): UseTfTreeResult => {
  const [state, setState] = useState<TfTreeState>(createEmptyTfTreeState);
  const [subscriptionRevision, setSubscriptionRevision] = useState(0);
  const stateRef = useRef(state);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    setState(stateRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(flush, 50);
  }, [flush]);

  const refresh = useCallback(() => {
    stateRef.current = createEmptyTfTreeState();
    flush();
    setSubscriptionRevision(revision => revision + 1);
  }, [flush]);

  const consume = useCallback(
    (message: unknown, source: TfSource) => {
      const tfMessage = message as { transforms?: unknown };
      if (source === 'dynamic' && detectClockReset(stateRef.current, tfMessage)) {
        refresh();
      }
      stateRef.current = consumeTfMessage(stateRef.current, tfMessage, source, Date.now());
      scheduleFlush();
    },
    [refresh, scheduleFlush]
  );

  useEffect(() => {
    if (!ros || !isActive) {
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
      return;
    }
    // A different connection is a different robot until proven otherwise.
    if (stateRef.current.knownFrames.size > 0) {
      stateRef.current = createEmptyTfTreeState();
      flush();
    }

    const dynamicTopic = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/TFMessage',
      queue_length: 1,
      throttle_rate: 50,
      compression: 'cbor',
    });
    const staticTopic = new ROSLIB.Topic({
      ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      queue_length: 1,
      throttle_rate: 0,
      compression: 'cbor',
    });

    dynamicTopic.subscribe(message => consume(message, 'dynamic'));
    staticTopic.subscribe(message => consume(message, 'static'));

    return () => {
      dynamicTopic.unsubscribe();
      staticTopic.unsubscribe();
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [consume, flush, isActive, ros, subscriptionRevision]);

  return { state, refresh };
};
