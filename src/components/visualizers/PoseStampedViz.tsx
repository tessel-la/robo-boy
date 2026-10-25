import React, { useCallback } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../../utils/ros3d';
import { usePoseStampedClient, PoseStampedOptions } from '../../hooks/usePoseStampedClient';
import { CustomTFProvider } from '../../utils/tfUtils';

interface PoseStampedVizProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  fixedFrame: string;
  options?: PoseStampedOptions;
  visualizationId?: string;
  onStatus?: (id: string, status: string | null) => void;
}

const PoseStampedViz: React.FC<PoseStampedVizProps> = ({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  fixedFrame,
  options,
  visualizationId = '',
  onStatus,
}) => {
  const report = useCallback((status: string | null) => onStatus?.(visualizationId, status), [onStatus, visualizationId]);
  // Use the PoseStamped client hook
  const { isSubscribed } = usePoseStampedClient({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    topic,
    fixedFrame,
    options,
    onStatus: report,
  });

  // This component doesn't render any direct DOM elements,
  // as the hook adds objects to the ROS3D.Viewer scene.
  React.useEffect(() => {
    if (isSubscribed) {
      console.log(`[PoseStampedViz] Subscribed to topic: ${topic}`);
    }
  }, [isSubscribed, topic]);

  return null;
};

export default React.memo(PoseStampedViz);
