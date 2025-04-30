import React from 'react';
import { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import { useCameraInfoVisualizer } from '../../hooks/useCameraInfoVisualizer';
import { CustomTFProvider } from '../../utils/tfUtils';

interface CameraInfoVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  options?: { lineColor?: THREE.Color | number | string; lineScale?: number };
}

const CameraInfoViz: React.FC<CameraInfoVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  options,
}) => {
  useCameraInfoVisualizer({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    selectedCameraInfoTopic: topic, // Pass the specific topic for this instance
    lineColor: options?.lineColor,
    lineScale: options?.lineScale,
  });

  // This component manages the hook lifecycle but renders nothing itself
  return null;
};

// Memoize to prevent unnecessary hook re-runs if props haven't changed
export default React.memo(CameraInfoViz); 