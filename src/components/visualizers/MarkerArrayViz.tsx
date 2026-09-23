import { useEffect, RefObject } from 'react';
import { Ros } from 'roslib';
import { Viewer } from '../../utils/ros3d';
import { CustomTFProvider } from '../../utils/tfUtils';
import { MarkerArrayClient } from '../../utils/markerArrayClient';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';

export default function MarkerArrayViz({ ros, topic, viewer, provider, ready }: {
  ros: Ros | null; topic: string; viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>; ready: boolean;
}) {
  const { meshResourcesBaseUrl } = useRuntimeConfig();
  useEffect(() => {
    if (!ready || !ros?.isConnected || !viewer.current || !provider.current) return;
    const client = new MarkerArrayClient({ ros, topic, rootObject: viewer.current.scene,
      tfClient: provider.current, path: meshResourcesBaseUrl, requestRender: viewer.current.requestRender });
    return () => client.dispose();
  }, [ros, topic, viewer, provider, ready, meshResourcesBaseUrl]);
  return null;
}
