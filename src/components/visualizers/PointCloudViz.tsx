import React from 'react';
import { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import { usePointCloudClient } from '../../hooks/usePointCloudClient';
import { CustomTFProvider } from '../../utils/tfUtils';

interface PointCloudVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  // Add options prop later if needed for color, size, etc.
  // options?: { color?: number | string; size?: number };
}

const PointCloudViz: React.FC<PointCloudVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  // options, // Destructure options later
}) => {
  usePointCloudClient({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    selectedPointCloudTopic: topic, // Pass the specific topic for this instance
    // Pass options to hook if implemented, e.g.:
    // material: {
    //   color: options?.color ?? 0x00ff00,
    //   size: options?.size ?? 0.05,
    // },
  });

  // This component manages the hook lifecycle but renders nothing itself
  return null;
};

// Memoize to prevent unnecessary hook re-runs if props haven't changed
export default React.memo(PointCloudViz); 