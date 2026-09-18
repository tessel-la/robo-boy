import { useEffect, useRef, useState } from 'react';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three'; // Needed for type hints during disposal
import { subscribeToXrPresentation } from '../xr/xrPresentationBus';

// Custom Hook for managing ROS3D Viewer lifecycle
export function useRos3dViewer(viewerRef: React.RefObject<HTMLDivElement>, isRosConnected: boolean) {
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null);
  const orbitControlsRef = useRef<any | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const resizeFrameId = useRef<number | null>(null);
  const pendingResize = useRef<{ width: number; height: number } | null>(null);
  const [viewerGeneration, setViewerGeneration] = useState(0);

  useEffect(() => {
    const currentViewerRef = viewerRef.current;
    let disposed = false;

    // --- Viewer Teardown Logic --- (Copied and adapted from VisualizationPanel)
    const cleanupViewer = () => {
      disposed = true;
      console.log('[useRos3dViewer Cleanup] Cleaning up ROS3D viewer, Grid, OrbitControls...');

      // Stop ResizeObserver first
      if (resizeObserver.current) {
        resizeObserver.current.disconnect();
        console.log('[useRos3dViewer Cleanup] ResizeObserver detached.');
        resizeObserver.current = null;
      }
      if (resizeFrameId.current !== null) {
        cancelAnimationFrame(resizeFrameId.current);
        resizeFrameId.current = null;
        pendingResize.current = null;
      }

      if (orbitControlsRef.current) {
        try {
          if (typeof orbitControlsRef.current.dispose === 'function') {
            orbitControlsRef.current.dispose();
          }
        } catch (e) {
          console.warn('[useRos3dViewer Cleanup] Error disposing OrbitControls:', e);
        }
        orbitControlsRef.current = null;
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
              try {
                if ('map' in mat && mat.map) (mat as THREE.MeshStandardMaterial).map!.dispose();
                mat.dispose();
              } catch (e) { console.warn('[Viewer Cleanup] Error disposing material in array:', e); }
            });
          } else {
            try {
              if ('map' in material && material.map) (material as THREE.MeshStandardMaterial).map!.dispose();
              material.dispose();
            } catch (e) { console.warn('[Viewer Cleanup] Error disposing single material:', e); }
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
            ros3dViewer.current.renderer?.forceContextLoss?.();
          }
          console.log('[useRos3dViewer Cleanup] Viewer resources likely released.');
        } catch (e) {
          console.warn("[useRos3dViewer Cleanup] Error during viewer cleanup", e);
        }
      }
      ros3dViewer.current = null;
      gridClient.current = null;
      console.log('[useRos3dViewer Cleanup] Viewer refs nulled.');
    };

    const initializeViewer = (width: number, height: number) => {
      if (disposed || !currentViewerRef || !isRosConnected || ros3dViewer.current || width <= 0 || height <= 0) {
        return;
      }

      if (!currentViewerRef.id) {
        currentViewerRef.id = `viewer-container-${Date.now()}`;
      }

      console.log(`[useRos3dViewer Setup] Initializing ROS3D Viewer for div#${currentViewerRef.id}...`);
      try {
        const viewer = new ROS3D.Viewer({
          divID: currentViewerRef.id,
          width,
          height,
          antialias: true,
          background: undefined as any,
          cameraPose: { x: 3, y: 3, z: 3 }
        });
        ros3dViewer.current = viewer;
        console.log('[useRos3dViewer Setup] ROS3D.Viewer created.');

        const grid = new ROS3D.Grid();
        viewer.addObject(grid);
        gridClient.current = grid;
        console.log('[useRos3dViewer Setup] ROS3D.Grid added.');

        if (ROS3D.OrbitControls) {
          orbitControlsRef.current = new ROS3D.OrbitControls({
            scene: viewer.scene,
            camera: viewer.camera,
            userZoomSpeed: 0.2,
            userPanSpeed: 0.2,
            element: currentViewerRef,
            onChange: viewer.requestRender,
          });
          console.log('[useRos3dViewer Setup] OrbitControls initialized.');
        } else {
          console.warn('[useRos3dViewer Setup] ROS3D.OrbitControls not found.');
        }
        // Ref mutation alone does not wake effects that skipped setup while the container was 0x0.
        // A generation change lets the panel retry all viewer-dependent lifecycles.
        setViewerGeneration(current => current + 1);
      } catch (error) {
        console.error("[useRos3dViewer Setup] Error initializing ROS3D Viewer/Components:", error);
        cleanupViewer();
      }
    };

    // Observe before the first initialization attempt. Freshly mounted split panels can briefly
    // report 0x0 while layout settles; the first non-zero observation must initialize the viewer.
    if (currentViewerRef && isRosConnected) {
      const observer = new ResizeObserver(entries => {
        const entry = entries[0];
        if (!entry || disposed) return;

        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;

        if (!ros3dViewer.current) {
          initializeViewer(width, height);
          return;
        }

        pendingResize.current = { width, height };
        if (resizeFrameId.current === null) {
          resizeFrameId.current = requestAnimationFrame(() => {
            resizeFrameId.current = null;
            const nextSize = pendingResize.current;
            pendingResize.current = null;
            if (nextSize && ros3dViewer.current) {
              ros3dViewer.current.resize(nextSize.width, nextSize.height);
            }
          });
        }
      });
      resizeObserver.current = observer;
      observer.observe(currentViewerRef);
      console.log('[useRos3dViewer Setup] ResizeObserver is now observing the viewer container.');

      initializeViewer(currentViewerRef.clientWidth, currentViewerRef.clientHeight);
      if (!disposed && !ros3dViewer.current) {
        console.warn('[useRos3dViewer Setup] Viewer div has zero width or height. Waiting for layout.');
      }
    } else {
      console.log('[useRos3dViewer] Prerequisites not met or ROS disconnected. Cleaning up viewer if it exists...');
      cleanupViewer(); // Cleanup if ROS disconnects or div not ready
    }

    // Return cleanup function specific to this effect
    return cleanupViewer;

    // Dependencies: Re-run when ROS connection state changes or the container ref changes (though ref should be stable)
  }, [viewerRef, isRosConnected]);

  // Stand down while a headset is presenting.
  //
  // This viewer never loops, but every arriving transform invalidates it, so on a busy /tf it keeps
  // drawing frames to a page nobody is looking at while an immersive session needs the same GPU.
  // OrbitControls is disabled alongside it because its listeners are bound to the container element
  // and would otherwise still move a camera that is no longer driving anything visible.
  //
  // With no XR session ever started, subscribeToXrPresentation reports false once and never fires
  // again, so this is inert for every existing deployment.
  useEffect(() => {
    // The bus replays its current value to every new subscriber, so the first callback is a
    // statement of where things already stand rather than a change. Acting on it would request a
    // needless frame on every mount, which is exactly the waste the invalidation model exists to
    // avoid.
    let applied: boolean | null = null;

    return subscribeToXrPresentation(isPresenting => {
      if (applied === isPresenting) return;
      const isInitial = applied === null;
      applied = isPresenting;

      const viewer = ros3dViewer.current;
      const controls = orbitControlsRef.current;
      if (controls) controls.enabled = !isPresenting;
      if (!viewer) return;

      if (isPresenting) {
        viewer.stop();
      } else if (!isInitial) {
        // One frame on the way back, so the panel is not left showing whatever was on screen when
        // the session began. Skipped on the initial callback, where nothing was ever suspended.
        viewer.requestRender();
      }
    });
  }, [viewerGeneration]);

  // Return the refs needed by the component
  return { ros3dViewer, viewerGeneration };
}
