import React, { useEffect, useRef, useState } from 'react';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, TransformStore } from '../utils/tfUtils';
import * as ROS3D from 'ros3d'; // Needed for Viewer type hint

interface UseTfProviderProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>; // Pass the viewer ref itself
  fixedFrame: string;
  // Pass initial transforms for provider constructor
  initialTransforms: TransformStore;
  handleTFMessage: (message: any, isStatic: boolean) => void; // Callback to update transforms state
}

// Custom Hook for managing the CustomTFProvider and TF subscriptions
export function useTfProvider({
  ros,
  isRosConnected,
  ros3dViewer,
  fixedFrame,
  initialTransforms, // Use this prop now
  handleTFMessage,
}: UseTfProviderProps) {
  const customTFProvider = useRef<CustomTFProvider | null>(null);
  const tfSub = useRef<ROSLIB.Topic | null>(null);
  const tfStaticSub = useRef<ROSLIB.Topic | null>(null);
  // Internal state to signal when the provider instance is ready
  const [isProviderReady, setIsProviderReady] = useState<boolean>(false);

  // Effect 1: Manage TF Provider instance and Fixed Frame updates
  useEffect(() => {
    let didCreateProvider = false; // Flag to track if *this* effect run created the provider

    // Check prerequisites
    if (ros && isRosConnected && ros3dViewer.current) {
      if (!customTFProvider.current) {
        customTFProvider.current = new CustomTFProvider(fixedFrame, initialTransforms);
        setIsProviderReady(true);
        didCreateProvider = true;
      } else {
        // Provider exists, update fixed frame if it changed
        // console.log(`[TF Provider Effect] Updating fixedFrame to: ${fixedFrame}`);
        customTFProvider.current.updateFixedFrame(fixedFrame);
        // Ensure readiness state is true if prerequisites re-established
        if (!isProviderReady) {
           setIsProviderReady(true);
        }
      }
    } else {
      // Prerequisites lost
      // console.log('[TF Provider Effect] Prerequisites lost.');
      if (customTFProvider.current) {
        customTFProvider.current.dispose();
        customTFProvider.current = null;
      }
      if (isProviderReady) {
        // Only update state if it was previously ready
        setIsProviderReady(false);
      }
    }

    // Cleanup function for *this* effect (Provider instance lifecycle)
    return () => {
      // If the component unmounts OR if dependencies change causing cleanup,
      // ensure the provider instance is disposed *if it was created by this run and still exists*
      // However, standard cleanup should handle component unmount. 
      // We mainly rely on the prerequisite check above to dispose when connection is lost.
      // Let's simplify: only dispose if unmounting *while* provider exists?
      // No, the prerequisite check handles disposal on dependency change (like disconnect).
      // The main purpose of *this* return cleanup is component unmount.
      // If we created it this run, and it still exists (wasn't cleaned by prereq check), dispose? Seems complex. 
      
      // Let's stick to the original simple idea: if the provider exists when this effect cleans up,
      // try disposing it. This handles component unmount.
      // It might be redundant if prereqs were lost *just* before unmount, but safe.
      // Update: This is wrong, causes disposal on fixedFrame change. 
      
      // Corrected Logic: This cleanup should ONLY dispose if the component itself is unmounting.
      // How to detect unmount vs. dependency change? React doesn't provide a direct flag.
      // Best practice: Let Effect B handle subscription cleanup based on isProviderReady.
      // Let this effect solely manage the provider *instance*. If prereqs are lost,
      // instance is nulled. If component unmounts, this cleanup doesn't need to do much
      // because Effect B's cleanup will have run based on isProviderReady potentially changing.
      
      // Let's remove explicit disposal here and rely on the prerequisite logic
      // and Effect B's cleanup.
      // console.log('[TF Provider Effect] Component unmounting? No explicit disposal here.')
    };

  // Depend on prerequisites and fixedFrame for updates
  // initialTransforms is only needed for the very first creation
  // Adding it might cause unnecessary recreation if the parent passes a new object/array inadvertently.
  // Let's omit initialTransforms and rely on the check `!customTFProvider.current`
  }, [ros, isRosConnected, ros3dViewer, fixedFrame, initialTransforms]); // Re-add initialTransforms - needed for first creation if fixedFrame hasn't changed yet

  // Effect 2: Manage TF Subscriptions based on provider readiness
  useEffect(() => {
    const cleanupSubscriptions = () => {
      // console.log('[TF Subscription Effect] Cleaning up subscriptions...');
      tfSub.current?.unsubscribe();
      tfSub.current = null;
      tfStaticSub.current?.unsubscribe();
      tfStaticSub.current = null;
      // console.log('[TF Subscription Effect] Subscription refs nulled.');
    };

    // Only subscribe if provider is ready and ROS is connected
    if (isProviderReady && ros && customTFProvider.current) {
      // Check refs *before* subscribing to prevent duplicates if effect runs unexpectedly
      if (!tfSub.current) {
        tfSub.current = new ROSLIB.Topic({
          ros: ros,
          name: '/tf',
          messageType: 'tf2_msgs/TFMessage',
          throttle_rate: 100,
          compression: 'none'
        });
        tfSub.current.subscribe((msg: any) => handleTFMessage(msg, false));
      }
      if (!tfStaticSub.current) {
        tfStaticSub.current = new ROSLIB.Topic({
          ros: ros,
          name: '/tf_static',
          messageType: 'tf2_msgs/TFMessage',
          throttle_rate: 0,
          compression: 'none'
        });
        tfStaticSub.current.subscribe((msg: any) => handleTFMessage(msg, true));
      }
    } else {
      // Provider not ready or ROS disconnected, ensure subscriptions are cleaned up
      // console.log('[TF Subscription Effect] Prereqs not met, ensuring cleanup.');
      cleanupSubscriptions();
    }

    // Cleanup function for subscriptions
    return () => {
       cleanupSubscriptions();
    };

  // Depend on provider readiness, ROS connection, and the stable message handler
  // customTFProvider ref shouldn't be a dependency itself, readiness flag handles it.
  }, [isProviderReady, ros, handleTFMessage]);

  // Return the TF provider instance ref, needed by the PointCloud client
  return { customTFProvider };
} 