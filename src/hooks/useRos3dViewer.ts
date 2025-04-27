import React, { useEffect, useRef } from 'react';
import * as ROS3D from 'ros3d';
import * as THREE from 'three'; // Needed for type hints during disposal

// Custom Hook for managing ROS3D Viewer lifecycle
export function useRos3dViewer(viewerRef: React.RefObject<HTMLDivElement>, isRosConnected: boolean) {
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null);
  const orbitControlsRef = useRef<any | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const currentViewerRef = viewerRef.current;
    let viewerInitializedThisEffect = false;

    // --- Viewer Teardown Logic --- (Copied and adapted from VisualizationPanel)
    const cleanupViewer = () => {
      console.log('[useRos3dViewer Cleanup] Cleaning up ROS3D viewer, Grid, OrbitControls...');

      // Stop ResizeObserver first
      if (resizeObserver.current && currentViewerRef) {
        resizeObserver.current.unobserve(currentViewerRef);
        console.log('[useRos3dViewer Cleanup] ResizeObserver detached.');
        resizeObserver.current = null;
      }

      // Helper function to recursively dispose of resources in the scene graph
      const disposeSceneResources = (obj: THREE.Object3D) => {
        if (!obj) return;
        if (obj.children && obj.children.length > 0) {
          [...obj.children].forEach(child => {
            disposeSceneResources(child);
            try { obj.remove(child); } catch (e) { console.warn('[Viewer Cleanup] Error removing child object:', e); }
          });
        }
        if ((obj as THREE.Mesh).geometry) {
          try { (obj as THREE.Mesh).geometry.dispose(); } catch (e) { console.warn('[Viewer Cleanup] Error disposing geometry:', e); }
        }
        if ((obj as THREE.Mesh).material) {
          const material = (obj as THREE.Mesh).material;
          if (Array.isArray(material)) {
            material.forEach((mat: THREE.Material) => {
              try { if (mat.map) mat.map.dispose(); mat.dispose(); } catch (e) { console.warn('[Viewer Cleanup] Error disposing material in array:', e); }
            });
          } else {
            try { if (material.map) material.map.dispose(); material.dispose(); } catch (e) { console.warn('[Viewer Cleanup] Error disposing single material:', e); }
          }
        }
        if ((obj as any).texture) {
          try { (obj as any).texture.dispose(); } catch (e) { console.warn('[Viewer Cleanup] Error disposing texture:', e); }
        }
      };

      if (ros3dViewer.current) {
        try {
          console.log('[useRos3dViewer Cleanup] Destroying Viewer resources...');
          if (ros3dViewer.current.renderer) {
            ros3dViewer.current.stop();
            if (ros3dViewer.current.scene) {
              console.log('[useRos3dViewer Cleanup] Starting scene resource disposal...');
              disposeSceneResources(ros3dViewer.current.scene);
              console.log('[useRos3dViewer Cleanup] Finished scene resource disposal.');
            }
            if (ros3dViewer.current.renderer.domElement.parentElement) {
              ros3dViewer.current.renderer.domElement.parentElement.removeChild(ros3dViewer.current.renderer.domElement);
            }
            ros3dViewer.current.renderer?.dispose();
          }
          console.log('[useRos3dViewer Cleanup] Viewer resources likely released.');
        } catch (e) {
          console.warn("[useRos3dViewer Cleanup] Error during viewer cleanup", e);
        }
      }
      ros3dViewer.current = null;
      gridClient.current = null;
      orbitControlsRef.current = null;
      console.log('[useRos3dViewer Cleanup] Viewer refs nulled.');
    };

    // --- Viewer Setup Logic --- (Copied and adapted from VisualizationPanel)
    if (currentViewerRef && isRosConnected) {
      // Only initialize if viewer doesn't exist yet
      if (!ros3dViewer.current) {
        // Ensure the viewer container has an ID
        if (!currentViewerRef.id) {
          // Generate a unique ID if one doesn't exist
          currentViewerRef.id = `viewer-container-${Date.now()}`;
        }
        
        console.log(`[useRos3dViewer Setup] Initializing ROS3D Viewer for div#${currentViewerRef.id}...`);
        if (currentViewerRef.clientWidth > 0 && currentViewerRef.clientHeight > 0) {
          try {
            const viewer = new ROS3D.Viewer({
              divID: currentViewerRef.id,
              width: currentViewerRef.clientWidth,
              height: currentViewerRef.clientHeight,
              antialias: true,
              background: undefined as any,
              cameraPose: { x: 3, y: 3, z: 3 }
            });
            ros3dViewer.current = viewer;
            viewerInitializedThisEffect = true;
            console.log('[useRos3dViewer Setup] ROS3D.Viewer created.');

            const grid = new ROS3D.Grid();
            viewer.addObject(grid);
            gridClient.current = grid; // Store ref to grid if needed later
            console.log('[useRos3dViewer Setup] ROS3D.Grid added.');

            if (ROS3D.OrbitControls) {
              orbitControlsRef.current = new ROS3D.OrbitControls({
                scene: viewer.scene,
                camera: viewer.camera,
                userZoomSpeed: 0.2,
                userPanSpeed: 0.2,
                element: currentViewerRef
              });
              console.log('[useRos3dViewer Setup] OrbitControls initialized.');
            } else {
              console.warn('[useRos3dViewer Setup] ROS3D.OrbitControls not found.');
            }

            // --- Setup Resize Observer ---
            const observer = new ResizeObserver(entries => {
              const entry = entries[0];
              if (entry && ros3dViewer.current) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                  ros3dViewer.current.resize(width, height);
                }
              }
            });
            observer.observe(currentViewerRef);
            resizeObserver.current = observer; // Store observer ref
            console.log('[useRos3dViewer Setup] ResizeObserver is now observing the viewer container.');
            // ---------------------------

          } catch (error) {
            console.error("[useRos3dViewer Setup] Error initializing ROS3D Viewer/Components:", error);
            cleanupViewer(); // Cleanup on error
          }
        } else {
          console.warn('[useRos3dViewer Setup] Viewer div has zero width or height. Skipping initialization.');
        }
      }
    } else {
      console.log('[useRos3dViewer] Prerequisites not met or ROS disconnected. Cleaning up viewer if it exists...');
      cleanupViewer(); // Cleanup if ROS disconnects or div not ready
    }

    // Return cleanup function specific to this effect
    return cleanupViewer;

    // Dependencies: Re-run when ROS connection state changes or the container ref changes (though ref should be stable)
  }, [viewerRef, isRosConnected]);

  // Return the refs needed by the component
  return { ros3dViewer /* , gridClient, orbitControlsRef */ }; // Only return viewer for now, adjust as needed
} 