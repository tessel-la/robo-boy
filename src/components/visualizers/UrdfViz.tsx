import React, { useEffect } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d';
import { useUrdfClient } from '../../hooks/useUrdfClient';
import { CustomTFProvider } from '../../utils/tfUtils'; // Assuming TF Provider is needed like in PointCloudViz

interface UrdfVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>; // Or ROS3D.TfClient if that's what UrdfClient expects
  robotDescriptionTopic?: string;
  urdfPath?: string; // Base path for mesh resources
  // Add any other URDF specific options here, e.g., loader type if configurable
}

const UrdfViz: React.FC<UrdfVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider, // Ensure this is the correct TF client type for UrdfClient
  robotDescriptionTopic = '/robot_description',
  urdfPath = '/',
}) => {
  // Use the useUrdfClient hook
  const { urdfClient, isUrdfLoaded } = useUrdfClient({
    ros,
    isRosConnected,
    ros3dViewer,
    tfClient: customTFProvider, // Match prop name, ensure type compatibility with useUrdfClient
    robotDescriptionTopic,
    urdfPath,
  });

  useEffect(() => {
    if (isUrdfLoaded) {
      console.log('[UrdfViz] URDF model loaded and rendered.', urdfClient);
      // Perform any actions after URDF is loaded, e.g., adjust camera
    } else {
      console.log('[UrdfViz] URDF not yet loaded or an issue occurred.');
    }
  }, [isUrdfLoaded, urdfClient]);

  // This component doesn't render any direct DOM elements itself,
  // as the UrdfClient adds objects to the ROS3D.Viewer scene.
  return null;
};

export default UrdfViz; 