import React from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d';
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
  id?: string;
  onObject?: (id: string, object: THREE.Group | null, frustum?: THREE.LineSegments) => void;
}

const CameraInfoViz: React.FC<CameraInfoVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  options,
  id,
  onObject,
}) => {
  useCameraInfoVisualizer({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    selectedCameraInfoTopic: topic, // Pass the specific topic for this instance
    lineColor: options?.lineColor,
    lineScale: options?.lineScale,
    onObject: (object, frustum) => { if (id) onObject?.(id, object, frustum); },
  });

  // This component manages the hook lifecycle but renders nothing itself
  return null;
};

// Memoize to prevent unnecessary hook re-runs if props haven't changed
export default React.memo(CameraInfoViz);
