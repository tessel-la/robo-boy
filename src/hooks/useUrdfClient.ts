import { useEffect, useRef, useState } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../utils/ros3d'; // Adjusted path if utils/ros3d.ts is the entry point
import { Object3D } from 'three';
import { CustomTFProvider } from '../utils/tfUtils'; // Import CustomTFProvider

interface UseUrdfClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  tfClient: React.RefObject<CustomTFProvider | null>; // Changed to CustomTFProvider
  robotDescriptionTopic?: string; // Topic for URDF string
  urdfPath?: string; // Base path for mesh resources
  // Consider adding loader options if your UrdfClient supports them
  // loader?: any;
}

export function useUrdfClient({
  ros,
  isRosConnected,
  ros3dViewer,
  tfClient,
  robotDescriptionTopic = '/robot_description',
}: UseUrdfClientProps) {
  const urdfClientRef = useRef<ROS3D.UrdfClient | null>(null);
  const [isUrdfLoaded, setIsUrdfLoaded] = useState(false);

  useEffect(() => {
    if (isRosConnected && ros && ros3dViewer.current && tfClient.current && !urdfClientRef.current) {
      console.log('[useUrdfClient] Initializing UrdfClient...');

      const urdfClient = new ROS3D.UrdfClient({
        ros: ros,
        tfClient: tfClient.current,
        rootObject: ros3dViewer.current.scene, // Add to the main viewer scene
        robotDescriptionTopic: robotDescriptionTopic,
        onComplete: (model: Object3D) => {
          console.log('[useUrdfClient] URDF model loaded successfully.', model);
          setIsUrdfLoaded(true);
          // You might want to adjust camera or do other actions here
        },
      });
      urdfClientRef.current = urdfClient;
    } else if ((!isRosConnected || !ros3dViewer.current || !tfClient.current) && urdfClientRef.current) {
      console.log('[useUrdfClient] Cleaning up UrdfClient...');
      urdfClientRef.current.dispose();
      urdfClientRef.current = null;
      setIsUrdfLoaded(false);
    }

    // Cleanup function
    return () => {
      if (urdfClientRef.current) {
        console.log('[useUrdfClient] Disposing UrdfClient on unmount.');
        urdfClientRef.current.dispose();
        urdfClientRef.current = null;
        setIsUrdfLoaded(false);
      }
    };
  }, [isRosConnected, ros, ros3dViewer, tfClient, robotDescriptionTopic]);

  return { urdfClient: urdfClientRef.current, isUrdfLoaded };
} 