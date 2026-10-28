import { useEffect, useRef, RefObject } from 'react';
import { Ros } from 'roslib';
import { Viewer } from '../../utils/ros3d';
import { CustomTFProvider } from '../../utils/tfUtils';
import { MarkerArrayClient } from '../../utils/markerArrayClient';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';

export default function MarkerArrayViz({
  ros,
  topic,
  viewer,
  provider,
  ready,
  opacity = 1,
  layerId,
}: {
  ros: Ros | null;
  topic: string;
  viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>;
  ready: boolean;
  opacity?: number;
  layerId?: string;
}) {
  const { meshResourcesBaseUrl } = useRuntimeConfig();
  const clientRef = useRef<MarkerArrayClient | null>(null);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  useEffect(() => {
    if (!ready || !ros?.isConnected || !viewer.current || !provider.current) return;
    const client = new MarkerArrayClient({
      ros,
      topic,
      rootObject: viewer.current.scene,
      tfClient: provider.current,
      opacity: opacityRef.current,
      layerId,
      path: meshResourcesBaseUrl,
      requestRender: viewer.current.requestRender,
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [ros, topic, viewer, provider, ready, meshResourcesBaseUrl, layerId]);
  useEffect(() => {
    clientRef.current?.setOpacity(opacity);
  }, [opacity]);
  return null;
}
