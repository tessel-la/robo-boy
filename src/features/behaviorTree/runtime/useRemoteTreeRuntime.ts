import { useEffect, useState } from 'react';
import { Ros } from 'roslib';
import { RemoteTreeRuntime } from './RemoteTreeRuntime';
import { RuntimeState } from './types';

const empty: RuntimeState = { connected: false, runtimes: [], session: null, logs: [], error: null, observations: [] };
export function useRemoteTreeRuntime(ros: Ros | null, isConnected: boolean) {
  const [client, setClient] = useState<RemoteTreeRuntime | null>(null);
  const [state, setState] = useState<RuntimeState>(empty);
  useEffect(() => {
    if (!ros || !isConnected || typeof (ros as any).callOnConnection !== 'function') {
      setClient(null);
      setState(previous => ({
        ...empty,
        error:
          previous.session?.state === 'running'
            ? 'ROS disconnected. Remote execution may still be running. Reconnect to recover its status.'
            : null,
      }));
      return;
    }
    setState(empty);
    const runtime = new RemoteTreeRuntime(ros);
    setClient(runtime);
    const unsubscribe = runtime.subscribe(setState);
    void runtime.discover().catch(() => {
      /* The client exposes its timeout/error state. */
    });
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  }, [ros, isConnected]);
  return { client, state };
}
