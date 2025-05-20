import React, { useEffect, useRef, useState } from 'react';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { CustomTFProvider, TransformStore } from '../utils/tfUtils';
import * as ROS3D from '../utils/ros3d'; // Use internal implementation

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
        // console.log(`[TF Provider Effect] Creating provider with fixedFrame: ${fixedFrame}`);
        customTFProvider.current = new CustomTFProvider(fixedFrame, initialTransforms);
        ros3dViewer.current.fixedFrame = fixedFrame; // Set viewer frame on creation
        setIsProviderReady(true);
        didCreateProvider = true;
      } else {
        // Provider exists, update fixed frame if it changed
        const currentProviderFixedFrame = customTFProvider.current.fixedFrame;
        const normalizedNewFixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame;

        if(currentProviderFixedFrame !== normalizedNewFixedFrame) {
            console.log(`[TF Provider Effect] Fixed frame changed from ${currentProviderFixedFrame} to: ${normalizedNewFixedFrame}`);
            
            // First update the viewer to ensure consistent state
            if (ros3dViewer.current) {
                ros3dViewer.current.fixedFrame = normalizedNewFixedFrame;
                console.log(`[TF Provider Effect] Updated viewer fixed frame to: ${normalizedNewFixedFrame}`);
            }
            
            // Then update the provider - this will trigger callbacks to visualizations
            customTFProvider.current.updateFixedFrame(normalizedNewFixedFrame);
            
            // Force a render update on the viewer if needed
            if (ros3dViewer.current && typeof ros3dViewer.current.render === 'function') {
                try {
                    ros3dViewer.current.render();
                    console.log(`[TF Provider Effect] Forced viewer render after frame change`);
                } catch (e) {
                    console.warn(`[TF Provider Effect] Error forcing viewer render:`, e);
                }
            }
        }

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
      // Let's remove explicit disposal here and rely on the prerequisite logic
      // and Effect B's cleanup.
      // console.log('[TF Provider Effect] Component unmounting? No explicit disposal here.')
    };

  // Depend on prerequisites and fixedFrame for updates
  }, [ros, isRosConnected, ros3dViewer, fixedFrame, initialTransforms]);

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
          throttle_rate: 25, // Update at 40Hz (25ms) to ensure smooth 30fps visualization
          queue_size: 1, // Only keep the latest message
          compression: 'none'
        });
        tfSub.current.subscribe((msg: any) => handleTFMessage(msg, false));
      }
      if (!tfStaticSub.current) {
        tfStaticSub.current = new ROSLIB.Topic({
          ros: ros,
          name: '/tf_static',
          messageType: 'tf2_msgs/TFMessage',
          throttle_rate: 1000, // Static transforms don't change often, throttle more aggressively
          queue_size: 1, // Only keep the latest message
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

  // Function to check if the provider is properly initialized with all required methods
  const ensureProviderFunctionality = () => {
    if (!customTFProvider.current) {
      console.error("[TF Provider] Provider not initialized yet");
      return false;
    }
    
    // Check for required methods
    const requiredMethods = ['lookupTransform', 'updateFixedFrame', 'subscribe', 'unsubscribe'];
    for (const method of requiredMethods) {
      if (typeof (customTFProvider.current as any)[method] !== 'function') {
        console.error(`[TF Provider] Provider missing required method: ${method}`);
        return false;
      }
    }
    
    // Add a getFixedFrame method if it doesn't exist (needed by some components)
    if (typeof (customTFProvider.current as any).getFixedFrame !== 'function') {
      console.log("[TF Provider] Adding getFixedFrame method to provider");
      (customTFProvider.current as any).getFixedFrame = function() {
        return this.fixedFrame;
      };
    }
    
    return true;
  };
  
  // Call this function each time the provider is created or updated
  useEffect(() => {
    if (customTFProvider.current) {
      ensureProviderFunctionality();
    }
  }, [isProviderReady]);

  // Return the TF provider instance ref, needed by the PointCloud client
  return { 
    customTFProvider,
    ensureProviderFunctionality // Export the function for external use
  };
} 