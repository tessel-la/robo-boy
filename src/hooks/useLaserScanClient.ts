import { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../utils/ros3d';
import { CustomTFProvider } from '../utils/tfUtils';
import { LaserScanOptions } from '../components/visualizers/LaserScanViz';

interface UseLaserScanClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  fixedFrame: string;
  selectedLaserScanTopic: string;
  material?: Partial<LaserScanOptions>; 
  options?: { maxRange?: number; minRange?: number }; // Example specific options for LaserScan
  clientRef: React.MutableRefObject<ROS3D.LaserScan | null>; 
}

export const useLaserScanClient = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  fixedFrame,
  selectedLaserScanTopic,
  material,
  options,
  clientRef,
}: UseLaserScanClientProps) => {
  // Use a more specific type for the internal ref
  const internalClientRef = useRef<ROS3D.LaserScan | null>(null);

  useEffect(() => {
    if (!ros || !isRosConnected || !ros3dViewer.current || !customTFProvider.current || !selectedLaserScanTopic) {
      if (internalClientRef.current) {
        console.log('[useLaserScanClient] Cleaning up LaserScan client for topic:', (internalClientRef.current as any).topicName); // Accessing private member for logging
        internalClientRef.current.unsubscribe(); 
        internalClientRef.current = null;
        if (clientRef) clientRef.current = null;
      }
      return;
    }

    // If there's an existing client for a different topic or fixed frame, remove it
    if (internalClientRef.current && 
        ((internalClientRef.current as any).topicName !== selectedLaserScanTopic || // Accessing private member
         internalClientRef.current.fixedFrame !== fixedFrame)) {
      console.log('[useLaserScanClient] Recreating LaserScan client due to topic or fixed frame change.');
      internalClientRef.current.unsubscribe();
      internalClientRef.current = null;
    }

    if (!internalClientRef.current) {
      console.log('[useLaserScanClient] Creating LaserScan client for topic:', selectedLaserScanTopic, 'fixedFrame:', fixedFrame);
      
      internalClientRef.current = new ROS3D.LaserScan({
        ros: ros,
        topic: selectedLaserScanTopic,
        tfClient: customTFProvider.current, 
        rootObject: ros3dViewer.current.scene, 
        fixedFrame: fixedFrame,
        material: {
            size: material?.pointSize,
            color: material?.pointColor,
        },
        maxRange: options?.maxRange,
        minRange: options?.minRange,
      });

      if (clientRef) {
        clientRef.current = internalClientRef.current;
      }
      console.log('[useLaserScanClient] ROS3D.LaserScan client created.');
    } else {
      // Potentially update existing client if only material/options changed, if supported by LaserScan class
      // For now, we recreate on topic/fixedFrame change. Settings updates are handled by LaserScanViz directly.
    }

    return () => {
      if (internalClientRef.current) {
        console.log('[useLaserScanClient] Cleaning up LaserScan client on unmount for topic:', (internalClientRef.current as any).topicName); // Accessing private member
        internalClientRef.current.unsubscribe();
        internalClientRef.current = null;
        if (clientRef) clientRef.current = null;
      }
    };
  }, [ros, isRosConnected, ros3dViewer, customTFProvider, fixedFrame, selectedLaserScanTopic, material, options, clientRef]);

  return { laserScanClient: internalClientRef.current };
}; 