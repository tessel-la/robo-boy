import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { filterCameraTopics } from '../features/customGamepad/rosMessageUtils';
import { runSerializedRosapi } from '../utils/rosapiQueue';

const DISCOVERY_TIMEOUT_MS = 10000;

/** One camera list per connection, shared by every camera panel in the workspace. */
export function useCameraTopics(ros: Ros | null, connected: boolean) {
  const [snapshot, setSnapshot] = useState({ ros, topics: [] as string[], refreshing: false, error: '' });
  const context = useRef<{
    ros: Ros;
    abort: AbortController;
    request: Promise<boolean> | null;
  } | null>(null);

  const refresh = useCallback((): Promise<boolean> => {
    const current = context.current;
    if (!current) return Promise.resolve(false);
    if (current.request) return current.request;
    const { ros, abort } = current;
    setSnapshot(previous => ({ ...previous, ros, refreshing: true, error: '' }));
    const requestAbort = new AbortController();
    const cancel = () => requestAbort.abort();
    abort.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, DISCOVERY_TIMEOUT_MS);
    current.request = runSerializedRosapi(
      ros,
      () => new Promise<{ topics: string[]; types: string[] }>((resolve, reject) => ros.getTopics(resolve, reject)),
      requestAbort.signal
    )
      .then(response => {
        if (context.current !== current) return false;
        const images = new Set(
          filterCameraTopics(response.topics.map((name, index) => ({ name, type: response.types[index] || '' }))).map(
            topic => topic.name
          )
        );
        const topics = [
          ...new Set(
            response.topics.filter(
              topic =>
                images.has(topic) ||
                topic.includes('image_raw') ||
                topic.includes('image_color') ||
                topic.includes('image_compressed')
            )
          ),
        ];
        setSnapshot({ ros, topics, refreshing: false, error: '' });
        return true;
      })
      .catch(() => {
        if (context.current === current) {
          setSnapshot(previous => ({
            ...previous,
            refreshing: false,
            error: requestAbort.signal.aborted
              ? 'Camera topic refresh timed out. Check the ROS connection and retry.'
              : 'Could not refresh camera topics. Check the ROS connection and retry.',
          }));
        }
        return false;
      })
      .finally(() => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', cancel);
        if (context.current === current) current.request = null;
      });
    return current.request;
  }, []);

  useEffect(() => {
    setSnapshot({ ros, topics: [], refreshing: false, error: '' });
    if (!ros || !connected) return;
    const current = { ros, abort: new AbortController(), request: null };
    context.current = current;
    void refresh();
    return () => {
      context.current = null;
      current.abort.abort();
    };
  }, [ros, connected, refresh]);

  const active = connected && snapshot.ros === ros;
  return {
    topics: active ? snapshot.topics : [],
    refreshing: active && snapshot.refreshing,
    error: active ? snapshot.error : '',
    refresh,
  };
}
