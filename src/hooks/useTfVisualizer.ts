import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import { Material } from 'three';
import { CustomTFProvider } from '../utils/tfUtils'; // Import the provider class

interface UseTfVisualizerProps {
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  displayedTfFrames: string[]; // Array of frame names to visualize
  axesScale?: number; // Optional scale for the axes
}

// Type for the map storing visualized axes
type TfAxesMap = Map<string, { group: THREE.Group; axes: ROS3D.Axes }>;

const DEFAULT_AXES_SCALE = 0.5;

export function useTfVisualizer({
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  displayedTfFrames,
  axesScale = DEFAULT_AXES_SCALE,
}: UseTfVisualizerProps) {
  const tfAxesContainerRef = useRef<THREE.Group | null>(null);
  const tfAxesMapRef = useRef<TfAxesMap>(new Map());
  const animationFrameId = useRef<number | null>(null);

  // Effect 1: Manage the main container for all TF axes
  useEffect(() => {
    const viewer = ros3dViewer.current;
    let containerAdded = false;

    if (isRosConnected && viewer) {
      if (!tfAxesContainerRef.current) {
        // console.log('[useTfVisualizer] Creating TF Axes container');
        tfAxesContainerRef.current = new THREE.Group();
        viewer.scene.add(tfAxesContainerRef.current);
        containerAdded = true;
      }
    }

    // Cleanup function for Effect 1
    return () => {
      // console.log('[useTfVisualizer] Cleanup Effect 1: Container');
      if (containerAdded && tfAxesContainerRef.current) {
        // console.log('[useTfVisualizer] Removing TF Axes container from scene');
        viewer?.scene.remove(tfAxesContainerRef.current);
        // Disposal of children happens in Effect 2's cleanup
        tfAxesContainerRef.current = null;
      } else if (!isRosConnected && tfAxesContainerRef.current) {
         // If ROS disconnected, ensure container is removed if it exists
         // console.log('[useTfVisualizer] ROS disconnected, removing TF Axes container');
         viewer?.scene.remove(tfAxesContainerRef.current);
         tfAxesContainerRef.current = null;
         // Children disposal is handled by Effect 2 cleanup triggered by dependency change
      }
    };
  }, [isRosConnected, ros3dViewer]);


  // Effect 2: Manage individual Axes objects based on displayedTfFrames
  useEffect(() => {
    const container = tfAxesContainerRef.current;
    const currentMap = tfAxesMapRef.current;
    if (!container) {
      // console.log('[useTfVisualizer] Effect 2 skipped: No container');
      return; // Need the container first
    }

    const framesToAdd = new Set<string>(displayedTfFrames);
    const framesToRemove = new Set<string>();
    const framesToKeep = new Set<string>(); // Not strictly needed but clearer

    // Identify frames to remove or keep
    currentMap.forEach((_: { group: THREE.Group; axes: ROS3D.Axes }, frameName: string) => {
      if (framesToAdd.has(frameName)) {
        framesToKeep.add(frameName);
        framesToAdd.delete(frameName); // Remove from add set, it already exists
      } else {
        framesToRemove.add(frameName);
      }
    });

    // Remove frames no longer needed
    framesToRemove.forEach((frameName: string) => {
      const entry = currentMap.get(frameName);
      if (entry) {
        // console.log(`[useTfVisualizer] Removing Axes for ${frameName}`);
        container.remove(entry.group);
        // Dispose geometry and material of the axes
        if (entry.axes.lineSegments) {
            entry.axes.lineSegments.geometry?.dispose();
            if (Array.isArray(entry.axes.lineSegments.material)) {
                entry.axes.lineSegments.material.forEach((m: Material) => m.dispose());
            } else {
                entry.axes.lineSegments.material?.dispose();
            }
        }
        currentMap.delete(frameName);
      }
    });

    // Add new frames
    framesToAdd.forEach((frameName: string) => {
      // console.log(`[useTfVisualizer] Adding Axes for ${frameName}`);
      const group = new THREE.Group();
      const axes = new ROS3D.Axes({
          lineSize: axesScale, // Rely on lineSize for scaling
      });
      group.add(axes);
      container.add(group);
      currentMap.set(frameName, { group, axes });
    });

    // Cleanup function for Effect 2
    return () => {
       // console.log('[useTfVisualizer] Cleanup Effect 2: Individual Axes');
       // When dependencies change (e.g., displayedTfFrames) or component unmounts,
       // clean up *all* axes managed by this hook instance.
       const mapToClear = tfAxesMapRef.current; // Use the ref's current value at cleanup time
       const containerAtCleanup = tfAxesContainerRef.current;

       mapToClear.forEach((entry: { group: THREE.Group; axes: ROS3D.Axes }, frameName: string) => {
         // console.log(`[useTfVisualizer Cleanup] Removing/Disposing Axes for ${frameName}`);
         containerAtCleanup?.remove(entry.group);
         if (entry.axes.lineSegments) {
             entry.axes.lineSegments.geometry?.dispose();
             if (Array.isArray(entry.axes.lineSegments.material)) {
                 entry.axes.lineSegments.material.forEach((m: Material) => m.dispose());
             } else {
                 entry.axes.lineSegments.material?.dispose();
             }
         }
       });
       mapToClear.clear(); // Clear the map itself
    };

  }, [displayedTfFrames, axesScale]); // Re-run when the list or scale changes

  // Effect 3: Animation loop to update axes poses
  useEffect(() => {
    const updateAxesPoses = () => {
      const viewer = ros3dViewer.current;
      const provider = customTFProvider.current;
      const container = tfAxesContainerRef.current;
      const currentMap = tfAxesMapRef.current;

      // Ensure everything needed is available
      if (!isRosConnected || !viewer || !provider || !container || currentMap.size === 0) {
        // console.log('[useTfVisualizer Loop] Skipping update (prerequisites not met)');
        animationFrameId.current = requestAnimationFrame(updateAxesPoses); // Continue loop
        return;
      }

      const fixedFrame = viewer.fixedFrame || 'odom'; // Use viewer's fixed frame

      currentMap.forEach((entry: { group: THREE.Group; axes: ROS3D.Axes }, frameName: string) => {
        const transform = provider.lookupTransform(frameName, fixedFrame);
        if (transform) {
          entry.group.position.copy(transform.translation);
          entry.group.quaternion.copy(transform.rotation);
          entry.group.visible = true;
        } else {
          // console.warn(`[useTfVisualizer Loop] TF lookup failed for ${frameName} relative to ${fixedFrame}`);
          entry.group.visible = false; // Hide if transform fails
        }
      });

      // Continue the loop
      animationFrameId.current = requestAnimationFrame(updateAxesPoses);
    };

    // Start the loop if connected and container exists
    if (isRosConnected && tfAxesContainerRef.current) {
      // console.log('[useTfVisualizer] Starting animation loop');
      animationFrameId.current = requestAnimationFrame(updateAxesPoses);
    } else {
      // console.log('[useTfVisualizer] Not starting animation loop (prerequisites not met)');
    }

    // Cleanup function for Effect 3
    return () => {
      // console.log('[useTfVisualizer] Cleanup Effect 3: Cancelling animation frame');
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isRosConnected, ros3dViewer, customTFProvider]); // Re-run if connection, viewer, or provider changes

  // No return value needed, hook manages side effects
} 