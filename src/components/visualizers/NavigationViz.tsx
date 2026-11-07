import { memo, useEffect, useRef, type RefObject } from 'react';
import type { Ros } from 'roslib';
import type { Viewer } from '../../utils/ros3d';
import type { CustomTFProvider } from '../../utils/tfUtils';
import type { NavigationDisplayOptions } from '../../utils/navigationOptions';
import { PathClient } from '../../utils/ros3d/visualizers/Path';
import { OccupancyGridClient } from '../../utils/ros3d/visualizers/OccupancyGrid';

const NavigationViz = memo(function NavigationViz({
  ros,
  connected,
  viewer,
  provider,
  ready,
  type,
  topic,
  options,
  id,
  onStatus,
}: {
  ros: Ros | null;
  connected: boolean;
  viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>;
  ready: boolean;
  type: 'path' | 'occupancygrid';
  topic: string;
  options?: NavigationDisplayOptions;
  id: string;
  onStatus: (id: string, status: string | null) => void;
}) {
  const client = useRef<PathClient | OccupancyGridClient>();
  const latest = useRef({ options, onStatus });
  latest.current = { options, onStatus };
  useEffect(() => {
    if (!ros || !connected || !ready || !viewer.current || !provider.current) return;
    const config = {
      ros,
      topic,
      tfClient: provider.current,
      rootObject: viewer.current.scene,
      requestRender: viewer.current.requestRender,
      options: latest.current.options,
      onStatus: (status: string | null) => latest.current.onStatus(id, status),
    };
    const instance =
      type === 'path'
        ? new PathClient(config)
        : new OccupancyGridClient({ ...config, maxTextureSize: viewer.current.renderer.capabilities.maxTextureSize });
    client.current = instance;
    return () => {
      instance.dispose();
      if (client.current === instance) client.current = undefined;
    };
  }, [ros, connected, viewer, provider, ready, type, topic, id]);
  useEffect(() => {
    client.current?.updateOptions(options);
  }, [options]);
  return null;
});

export default NavigationViz;
