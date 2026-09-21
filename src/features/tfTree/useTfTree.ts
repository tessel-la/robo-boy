import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';

import { resetTfStream, subscribeToTfMessages } from '../../utils/tfStream';
import { TfSource, TfTreeState, consumeTfMessage, createEmptyTfTreeState, detectClockReset } from './tfTreeModel';

interface UseTfTreeResult {
  state: TfTreeState;
  /** Forgets every transform on this connection (the 3D panels' shared stream included) and
   * subscribes again, so latched static transforms are re-sent and frames that stopped existing
   * disappear. */
  refresh: () => void;
}

/**
 * Builds the TF tree from the connection's shared `/tf` + `/tf_static` stream, so it never adds
 * a second rosbridge client (which would receive only part of the latched static set — see
 * `SharedTfStream`). The tree resets itself whenever the source does: a new ROS connection, or a
 * publisher whose stamps jump backwards (a simulator restart). A static transform whose publisher
 * simply died cannot be noticed from the browser (latched topics send no retraction), which is
 * what the manual refresh is still for.
 */
export const useTfTree = (ros: Ros | null, isActive = true): UseTfTreeResult => {
  const [state, setState] = useState<TfTreeState>(createEmptyTfTreeState);
  const stateRef = useRef(state);
  const rosRef = useRef(ros);
  rosRef.current = ros;
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
    if (rosRef.current) resetTfStream(rosRef.current);
  }, [flush]);

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

    const unsubscribe = subscribeToTfMessages(ros, (message, source: TfSource) => {
      const tfMessage = message as { transforms?: unknown };
      if (source === 'dynamic' && detectClockReset(stateRef.current, tfMessage)) {
        refresh();
      }
      stateRef.current = consumeTfMessage(stateRef.current, tfMessage, source, Date.now());
      scheduleFlush();
    });

    return () => {
      unsubscribe();
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    };
  }, [flush, isActive, refresh, ros, scheduleFlush]);

  return { state, refresh };
};
