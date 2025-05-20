import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d';
import * as THREE from 'three';
import { usePointCloudClient } from '../../hooks/usePointCloudClient';
import { CustomTFProvider } from '../../utils/tfUtils';
import { PointCloudOptions } from '../VisualizationPanel'; // Import the options type

interface PointCloudVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  fixedFrame: string;
  options?: PointCloudOptions;
}

const PointCloudViz: React.FC<PointCloudVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  fixedFrame,
  options,
}) => {
  // Keep a reference to the current client
  const clientRef = useRef<ROS3D.PointCloud2 | null>(null);

  // Prepare material options based on settings
  const materialOptions = {
    size: options?.pointSize ?? 0.05,
    colorMode: options?.colorAxis && options.colorAxis !== 'none' ? options.colorAxis : undefined,
    minAxisValue: options?.minAxisValue,
    maxAxisValue: options?.maxAxisValue,
    minColor: options?.minColor ? new THREE.Color(options.minColor) : undefined,
    maxColor: options?.maxColor ? new THREE.Color(options.maxColor) : undefined,
    // Convert hex color to THREE.Color if provided, otherwise use green
    color: options?.color ? new THREE.Color(options.color) : new THREE.Color(0x00ff00),
  };

  // Prepare other options
  const clientOptions = {
    maxPoints: options?.maxPoints ?? 200000,
  };

  // Use the hook and capture the client reference
  const { pointCloudClient } = usePointCloudClient({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    fixedFrame,
    selectedPointCloudTopic: topic,
    material: materialOptions,
    options: clientOptions,
    clientRef,  // Pass the ref to store the client
  });

  // Effect to update settings when options change
  useEffect(() => {
    if (clientRef.current && isRosConnected && options) {
      console.log('[PointCloudViz] Updating settings for point cloud:', topic);
      
      // Only apply settings that are enabled in the UI
      const updateOptions: any = {};
      
      // Update point size if enabled
      if (options.pointSizeEnabled && options.pointSize !== undefined) {
        updateOptions.pointSize = options.pointSize;
      }
      
      // Update color if enabled
      if (options.colorEnabled && options.color) {
        updateOptions.color = options.color;
      }
      
      // Apply the settings to the client
      clientRef.current.updateSettings(updateOptions);
    }
  }, [options, isRosConnected, topic]);

  // This component manages the hook lifecycle but renders nothing itself
  return null;
};

// Memoize to prevent unnecessary hook re-runs if props haven't changed
export default React.memo(PointCloudViz); 