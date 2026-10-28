import { useEffect, useRef, useState } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../utils/ros3d'; // Adjusted path if utils/ros3d.ts is the entry point
import { Object3D } from 'three';
import { CustomTFProvider } from '../utils/tfUtils'; // Import CustomTFProvider
import { useRuntimeConfig } from '../runtime/runtimeConfig';

interface UseUrdfClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  tfClient: React.RefObject<CustomTFProvider | null>; // Changed to CustomTFProvider
  dependenciesReady: boolean;
  robotDescriptionTopic?: string; // Topic for URDF string
  opacity?: number;
  layerId?: string;
  urdfPath?: string; // Base path for mesh resources
  // Consider adding loader options if your UrdfClient supports them
  // loader?: any;
}

export function useUrdfClient({
  ros,
  isRosConnected,
  ros3dViewer,
  tfClient,
  dependenciesReady,
  robotDescriptionTopic = '/robot_description',
  opacity = 1,
  layerId,
}: UseUrdfClientProps) {
  const { meshResourcesBaseUrl } = useRuntimeConfig();
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const urdfClientRef = useRef<ROS3D.UrdfClient | null>(null);
  const [isUrdfLoaded, setIsUrdfLoaded] = useState(false);

  useEffect(() => {
    setIsUrdfLoaded(false);
    const viewer = ros3dViewer.current;
    const provider = tfClient.current;
    if (!dependenciesReady || !isRosConnected || !ros || !viewer || !provider) return;

    let active = true;
    console.log('[useUrdfClient] Initializing UrdfClient...');
    const urdfClient = new ROS3D.UrdfClient({
      ros,
      tfClient: provider,
      rootObject: viewer.scene,
      robotDescriptionTopic,
      opacity: opacityRef.current,
      path: meshResourcesBaseUrl,
      requestRender: viewer.requestRender,
      onComplete: (model: Object3D) => {
        if (!active) return;
        console.log('[useUrdfClient] URDF model loaded successfully.', model);
        setIsUrdfLoaded(true);
        viewer.requestRender?.();
      },
    });
    urdfClientRef.current = urdfClient;
    if (layerId) {
      urdfClient.userData ??= {};
      urdfClient.userData.projectionLayer = layerId;
    }

    return () => {
      active = false;
      console.log('[useUrdfClient] Disposing UrdfClient.');
      urdfClient.dispose();
      if (urdfClientRef.current === urdfClient) urdfClientRef.current = null;
    };
  }, [dependenciesReady, isRosConnected, ros, ros3dViewer, tfClient, robotDescriptionTopic, meshResourcesBaseUrl, layerId]);

  useEffect(() => { urdfClientRef.current?.setOpacity(opacity); }, [opacity]);

  return { urdfClient: urdfClientRef.current, isUrdfLoaded };
}
