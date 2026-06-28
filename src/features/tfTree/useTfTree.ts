import { useCallback, useEffect, useRef, useState } from 'react';
import * as ROSLIB from 'roslib';
import type { Ros } from 'roslib';

import { TfSource, TfTreeState, consumeTfMessage, createEmptyTfTreeState } from './tfTreeModel';

interface UseTfTreeResult {
  state: TfTreeState;
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
  refresh: () => void;
}

export const useTfTree = (ros: Ros | null): UseTfTreeResult => {
  const [state, setState] = useState<TfTreeState>(createEmptyTfTreeState);
  const [isPaused, setIsPaused] = useState(false);
  const [subscriptionRevision, setSubscriptionRevision] = useState(0);
  const stateRef = useRef(state);
  const pausedRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    setState(stateRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (pausedRef.current || flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(flush, 50);
  }, [flush]);

  const consume = useCallback(
    (message: unknown, source: TfSource) => {
      stateRef.current = consumeTfMessage(stateRef.current, message as { transforms?: unknown }, source, Date.now());
      scheduleFlush();
    },
    [scheduleFlush]
  );

  useEffect(() => {
    if (!ros) return;

    const dynamicTopic = new ROSLIB.Topic({
      ros,
      name: '/tf',
      messageType: 'tf2_msgs/TFMessage',
      queue_size: 10,
      throttle_rate: 0,
      compression: 'cbor',
    });
    const staticTopic = new ROSLIB.Topic({
      ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      queue_size: 10,
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
  }, [consume, ros, subscriptionRevision]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    setIsPaused(true);
    if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    flush();
  }, [flush]);

  const refresh = useCallback(() => {
    pausedRef.current = false;
    setIsPaused(false);
    flush();
    setSubscriptionRevision(revision => revision + 1);
  }, [flush]);

  return { state, isPaused, pause, resume, refresh };
};
