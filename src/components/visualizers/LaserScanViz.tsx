import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d'; // Assuming LaserScan might be added here
import * as THREE from 'three';
import { useLaserScanClient } from '../../hooks/useLaserScanClient'; // Uncommented
import { CustomTFProvider } from '../../utils/tfUtils';

// Placeholder for LaserScanOptions - will need to be defined
export interface LaserScanOptions {
  pointSize?: number;
  pointColor?: string | THREE.Color;
  maxRange?: number; // Added for consistency with the hook
  minRange?: number; // Added for consistency with the hook
  // Add other LaserScan specific options:
  // e.g., drawLines?: boolean;
  // e.g., lineWidth?: number;
  // e.g., colorByIntensity?: boolean;
  // e.g., minIntensityColor?: string | THREE.Color;
  // e.g., maxIntensityColor?: string | THREE.Color;
}

interface LaserScanVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>; // Viewer from ros3d.ts
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  fixedFrame: string;
  options?: LaserScanOptions;
}

const DEFAULT_POINT_SIZE = 1.0;
const DEFAULT_POINT_COLOR_HEX = '#0000ff'; // Blue

const LaserScanViz: React.FC<LaserScanVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  fixedFrame,
  options,
}) => {
  const clientRef = useRef<ROS3D.LaserScan | null>(null); // Typed clientRef
  const previousFixedFrameRef = useRef<string>(fixedFrame);

  // Construct material properties dynamically from options or defaults
  const getMaterialColor = (colorOption: string | THREE.Color | undefined): THREE.Color => {
    if (colorOption instanceof THREE.Color) {
      return colorOption;
    }
    if (typeof colorOption === 'string') {
      try {
        return new THREE.Color(colorOption);
      } catch (e) {
        console.warn(`[LaserScanViz] Invalid color string: ${colorOption}, falling back to default.`);
        return new THREE.Color(DEFAULT_POINT_COLOR_HEX);
      }
    }
    return new THREE.Color(DEFAULT_POINT_COLOR_HEX);
  };

  const effectivePointSize = options?.pointSize ?? DEFAULT_POINT_SIZE;
  const effectivePointColor = getMaterialColor(options?.pointColor);

  const initialMaterialProps = {
    pointSize: effectivePointSize,
    pointColor: effectivePointColor,
  };

  const clientHookOptions = {
    maxRange: options?.maxRange,
    minRange: options?.minRange,
  };

  // Use the hook
  useLaserScanClient({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    fixedFrame,
    selectedLaserScanTopic: topic,
    material: initialMaterialProps, // Use dynamically constructed props
    options: clientHookOptions,
    clientRef,
  });

  // Effect to update settings when options change (e.g., from settings popup)
  useEffect(() => {
    if (clientRef.current && isRosConnected && options) {
      console.log('[LaserScanViz] Updating settings for laser scan:', topic, options);
      
      const newPointSize = options.pointSize ?? DEFAULT_POINT_SIZE;
      const newPointColor = getMaterialColor(options.pointColor);

      clientRef.current.updateSettings({
        pointSize: newPointSize,
        pointColor: newPointColor,
        maxRange: options.maxRange,
        minRange: options.minRange,
      });
    }
  // Ensure options object reference changes trigger this, or specific option values.
  // Deep comparison of options might be too heavy here, so rely on parent passing new object.
  }, [options, isRosConnected, topic]); // Dependencies remain the same

  // Effect to handle fixed frame changes
  useEffect(() => {
    if (!clientRef.current || !isRosConnected) return;

    if (previousFixedFrameRef.current !== fixedFrame) {
      console.log(`[LaserScanViz] Fixed frame changed from ${previousFixedFrameRef.current} to ${fixedFrame}`);
      clientRef.current.setFixedFrame(fixedFrame);
      previousFixedFrameRef.current = fixedFrame;
    }
  }, [fixedFrame, isRosConnected]);

  // This component manages the hook lifecycle but renders nothing itself
  return null;
};

export default React.memo(LaserScanViz); 