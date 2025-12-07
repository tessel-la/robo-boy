import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';
import { isMobile } from '../utils/platformUtils';
import {
  createPointCloudShaderMaterial,
  createInlineShaderMaterial,
  PointCloudShaderOptions
} from '../utils/pointCloudShaders';
import {
  cleanupPointCloudClient,
  clearPointCloudIntervals,
  createIntervalsRef,
  PointCloudIntervals
} from '../utils/pointCloudCleanup';

// Define the material options interface
interface PointCloudMaterialOptions {
  size?: number;
  color?: THREE.Color;
  colorMode?: 'x' | 'y' | 'z';
  minAxisValue?: number;
  maxAxisValue?: number;
  minColor?: THREE.Color;
  maxColor?: THREE.Color;
}

// Define the client options interface
interface PointCloudClientOptions {
  maxPoints?: number;
  throttleRate?: number;
}

// Define the hook props interface
interface UsePointCloudClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  selectedPointCloudTopic: string;
  fixedFrame: string;
  material?: PointCloudMaterialOptions;
  options?: PointCloudClientOptions;
  clientRef?: React.MutableRefObject<ROS3D.PointCloud2 | null>;
}

// Custom Hook for managing the PointCloud2 client lifecycle
export function usePointCloudClient({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  selectedPointCloudTopic,
  fixedFrame,
  material = {},
  options = {},
  clientRef,
}: UsePointCloudClientProps) {
  const pointsClient = useRef<ROS3D.PointCloud2 | null>(null);

  // Add refs to track detected axis ranges
  const axisRanges = useRef<{
    x: { min: number, max: number },
    y: { min: number, max: number },
    z: { min: number, max: number }
  }>({
    x: { min: 0, max: 0 },
    y: { min: 0, max: 0 },
    z: { min: 0, max: 0 }
  });

  // Track intervals at the hook level
  const intervalsRef = useRef<PointCloudIntervals>(createIntervalsRef());

  useEffect(() => {
    console.log('[usePointCloudClient] Running effect. Deps:', {
      isRosConnected,
      selectedPointCloudTopic,
      fixedFrame,
      materialChanged: !!material
    });

    // Keep track of the client created in this effect run for targeted cleanup
    let createdClientInstance: ROS3D.PointCloud2 | null = null;

    // --- Prerequisite Check ---
    if (!ros3dViewer.current || !ros || !isRosConnected || !customTFProvider.current || !selectedPointCloudTopic) {
      // Cleanup existing client if prerequisites fail after it was created
      if (pointsClient.current) {
        console.log("[usePointCloudClient Prereq Cleanup] Cleaning up existing main client.");
        cleanupPointCloudClient(pointsClient.current, ros3dViewer.current?.scene);
        pointsClient.current = null;
      }
      return;
    }

    // --- Cleanup Previous Client ---
    if (pointsClient.current) {
      console.log(`[usePointCloudClient] Dependencies changed. Cleaning up previous main client.`);
      cleanupPointCloudClient(pointsClient.current, ros3dViewer.current?.scene);
      pointsClient.current = null;
    }

    // Check if we're just changing color scheme
    const currentTopic = pointsClient.current ? ((pointsClient.current as any).topicName ||
      (pointsClient.current as any).topic || '') : '';

    const isJustColorChange = pointsClient.current &&
      ros && isRosConnected &&
      selectedPointCloudTopic === currentTopic;

    // If we're just changing color settings on the same topic, handle it differently
    if (isJustColorChange && material.colorMode) {
      const pointsObj = (pointsClient.current as any)?.points?.object;

      if (pointsObj && pointsObj.material) {
        const wasVisible = pointsObj.visible;
        const minColor = material.minColor || new THREE.Color(0x0000ff);
        const maxColor = material.maxColor || new THREE.Color(0xff0000);
        const safeInitialMin = material.minAxisValue ?? -10;
        const safeInitialMax = material.maxAxisValue ?? 10;

        // Create new shader material using extracted utility
        const newMaterial = createInlineShaderMaterial(
          material.colorMode,
          material.size || 0.05,
          minColor,
          maxColor,
          safeInitialMin,
          safeInitialMax
        );

        // Dispose of old material
        if (pointsObj.material && typeof pointsObj.material.dispose === 'function') {
          try {
            pointsObj.material.dispose();
          } catch (e) {
            console.warn("[Color Change] Error disposing old material:", e);
          }
        }

        // Apply the new material
        pointsObj.material = newMaterial;
        pointsObj.material.needsUpdate = true;
        pointsObj.visible = wasVisible;

        // Force render update
        if (ros3dViewer.current?.renderer) {
          ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
          requestAnimationFrame(() => {
            if (ros3dViewer.current?.renderer) {
              ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
            }
          });
        }

        // Return cleanup function
        return () => {
          clearPointCloudIntervals(intervalsRef.current);
        };
      }
    }

    // --- Only clean up previous client if we're actually changing topics ---
    if (pointsClient.current && !isJustColorChange) {
      console.log(`[usePointCloudClient] Topic changed. Cleaning up previous client.`);
      cleanupPointCloudClient(pointsClient.current, ros3dViewer.current?.scene);
      pointsClient.current = null;
    }

    // Check if fixed frame changed
    const isFixedFrameChange = pointsClient.current &&
      ros && isRosConnected &&
      fixedFrame !== ((pointsClient.current as any)._fixedFrame || '');

    if (isFixedFrameChange) {
      console.log(`[usePointCloudClient] Fixed frame changed. Recreating client.`);
      cleanupPointCloudClient(pointsClient.current, ros3dViewer.current?.scene);
      pointsClient.current = null;
    }

    // --- Create New Client ---
    console.log(`[usePointCloudClient] Creating new client for topic: ${selectedPointCloudTopic}`);

    // Create custom material with shader if colorMode is specified
    let customMaterial: THREE.Material | undefined = undefined;

    if (material.colorMode) {
      const shaderOptions: PointCloudShaderOptions = {
        colorMode: material.colorMode,
        minColor: material.minColor,
        maxColor: material.maxColor,
        minAxisValue: material.minAxisValue,
        maxAxisValue: material.maxAxisValue,
        pointSize: material.size
      };
      customMaterial = createPointCloudShaderMaterial(shaderOptions);
    }

    // Prepare regular material options
    const materialOptions = {
      size: material.size ?? 0.05,
      color: material.color ?? new THREE.Color(0x00ff00)
    };

    // Set client options with defaults
    const clientOptions: any = {
      ros: ros,
      tfClient: customTFProvider.current,
      rootObject: ros3dViewer.current.scene,
      topic: selectedPointCloudTopic,
      max_pts: options.maxPoints ?? (isMobile() ? 100000 : 200000),
      throttle_rate: options.throttleRate ?? 33, // ~30Hz
      compression: 'cbor' as const,
      queue_size: 1,
      fixedFrame: fixedFrame,
      messageHandler: function (message: any) {
        try {
          this.fixedFrame = fixedFrame;
          if (!this.tfClient || typeof this.tfClient.lookupTransform !== 'function') {
            console.warn('[PointCloud2] TF Client missing or lookupTransform not available');
            return;
          }
          if (message.header && message.header.frame_id) {
            try {
              this.processMessage(message);
            } catch (error) {
              console.error('[PointCloud2] Error in processMessage:', error);
            }
          }
        } catch (error) {
          console.error('[PointCloud2] Unhandled error in message handler:', error);
        }
      }
    };

    // Add material
    if (customMaterial) {
      clientOptions.material = customMaterial;
      clientOptions.customShader = true;

      // Platform-specific optimizations
      if (isMobile()) {
        console.log("[Mobile] Applying mobile-specific optimizations for point cloud");
        clientOptions.max_pts = Math.min(options.maxPoints ?? 100000, 50000);
      }
    } else {
      clientOptions.material = materialOptions;
    }

    try {
      const newClient = new ROS3D.PointCloud2(clientOptions);
      (newClient as any)._fixedFrame = fixedFrame;

      // Verify client creation
      if (!(newClient as any).points || !(newClient as any).points.setup) {
        console.warn("[usePointCloudClient] Points object not properly initialized, attempting recovery");
        if (typeof (newClient as any).safeResetPoints === 'function') {
          const success = (newClient as any).safeResetPoints();
          console.log(`[usePointCloudClient] Recovery ${success ? 'successful' : 'failed'}`);
        }
      } else {
        console.log("[usePointCloudClient] Points object properly initialized");
      }

      pointsClient.current = newClient;
      createdClientInstance = newClient;

      if (clientRef) {
        clientRef.current = newClient;
      }

      // Initialization delay
      setTimeout(() => {
        if (pointsClient.current && ros3dViewer.current?.renderer) {
          console.log("[usePointCloudClient] Initialization complete, client ready");
          ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
        }
      }, 300);

      // --- Post-Creation Intervals ---
      clearPointCloudIntervals(intervalsRef.current);

      // Check for scene addition
      intervalsRef.current.checkSceneInterval = setInterval(() => {
        if (ros3dViewer.current?.scene && createdClientInstance) {
          const internalPointsObject = (createdClientInstance as any)?.points?.object;
          const wrapperObject = internalPointsObject?.parent;
          if (wrapperObject && ros3dViewer.current.scene.children.includes(wrapperObject)) {
            if (intervalsRef.current.checkSceneInterval) clearInterval(intervalsRef.current.checkSceneInterval);
          }
        } else {
          if (intervalsRef.current.checkSceneInterval) clearInterval(intervalsRef.current.checkSceneInterval);
        }
      }, 100);

      // Frustum culling check
      intervalsRef.current.checkPointsObjectInterval = setInterval(() => {
        if (pointsClient.current?.points?.object) {
          pointsClient.current.points.object.frustumCulled = false;
          if (intervalsRef.current.checkPointsObjectInterval) clearInterval(intervalsRef.current.checkPointsObjectInterval);
        }
      }, 100);

      // Update axis ranges dynamically
      if (customMaterial && material.colorMode) {
        setupAxisRangeUpdates(
          pointsClient,
          material.colorMode,
          axisRanges,
          intervalsRef,
          ros3dViewer
        );
      }

      // --- Cleanup for This Effect Run ---
      return () => {
        clearPointCloudIntervals(intervalsRef.current);
        cleanupPointCloudClient(createdClientInstance, ros3dViewer.current?.scene);
      };

    } catch (error) {
      console.error(`[usePointCloudClient] Error creating PointCloud2 client:`, error);
      pointsClient.current = null;
      createdClientInstance = null;
    }

    // Fallback cleanup
    return () => {
      cleanupPointCloudClient(createdClientInstance, ros3dViewer.current?.scene);
    };

  }, [ros, isRosConnected, ros3dViewer, customTFProvider, selectedPointCloudTopic, material, options, fixedFrame]);

  return {
    axisRanges: axisRanges.current,
    pointCloudClient: pointsClient.current
  };
}

/**
 * Sets up interval-based axis range updates for dynamic color scaling.
 */
function setupAxisRangeUpdates(
  pointsClient: React.MutableRefObject<ROS3D.PointCloud2 | null>,
  colorMode: 'x' | 'y' | 'z',
  axisRanges: React.MutableRefObject<{
    x: { min: number, max: number },
    y: { min: number, max: number },
    z: { min: number, max: number }
  }>,
  intervalsRef: React.MutableRefObject<PointCloudIntervals>,
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>
): void {
  // Set initial low opacity
  if (pointsClient.current?.points?.object) {
    const pointsObj = pointsClient.current.points.object as THREE.Points;
    if (pointsObj.material) {
      (pointsObj.material as THREE.ShaderMaterial).opacity = 0.3;
      pointsObj.visible = true;
    }
  }

  let rangeCalculated = false;
  let retryCount = 0;
  const maxRetries = 10;
  const axisIndex = colorMode === 'x' ? 0 : (colorMode === 'y' ? 1 : 2);

  intervalsRef.current.updateRangesInterval = setInterval(() => {
    if (pointsClient.current?.points?.object) {
      const pointsObj = pointsClient.current.points.object as THREE.Points;
      const geometry = pointsObj.geometry as THREE.BufferGeometry;
      const positions = geometry.getAttribute('position') as THREE.BufferAttribute;

      if (positions && positions.count > 0) {
        let min = Infinity;
        let max = -Infinity;

        const sampleCount = Math.min(positions.count, 1000);
        const sampleStep = Math.max(1, Math.floor(positions.count / sampleCount));

        for (let i = 0; i < positions.count; i += sampleStep) {
          let val;
          if (axisIndex === 0) val = positions.getX(i);
          else if (axisIndex === 1) val = positions.getY(i);
          else val = positions.getZ(i);

          if (isFinite(val)) {
            if (val < min) min = val;
            if (val > max) max = val;
          }
        }

        if (isFinite(min) && isFinite(max) && max > min) {
          const shader = (pointsObj.material as THREE.ShaderMaterial);
          if (shader && shader.uniforms) {
            const range = max - min;
            const padding = range * 0.05;
            const safeMin = min - padding;
            const safeMax = Math.max(max + padding, safeMin + 0.001);

            shader.uniforms.minAxisValue = { value: safeMin };
            shader.uniforms.maxAxisValue = { value: safeMax };

            if (!rangeCalculated) {
              const mat = pointsObj.material as THREE.ShaderMaterial;
              mat.opacity = 1.0;
              mat.needsUpdate = true;

              if (ros3dViewer.current?.renderer) {
                ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                requestAnimationFrame(() => {
                  if (ros3dViewer.current?.renderer) {
                    ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                  }
                });
              }
              rangeCalculated = true;
            }

            // Update stored ranges
            axisRanges.current[colorMode] = { min, max };

            // Stop checking once we have good values
            clearInterval(intervalsRef.current.updateRangesInterval!);
            intervalsRef.current.updateRangesInterval = null;
          }
        } else {
          retryCount++;
          if (retryCount >= maxRetries) {
            // Use default values and make visible
            const shader = (pointsObj.material as THREE.ShaderMaterial);
            if (shader && shader.uniforms) {
              shader.uniforms.minAxisValue.value = -10;
              shader.uniforms.maxAxisValue.value = 10;
            }

            const mat = pointsObj.material;
            if (!Array.isArray(mat)) {
              mat.opacity = 1.0;
              mat.needsUpdate = true;
            }
            pointsObj.visible = true;

            if (ros3dViewer.current?.renderer) {
              ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
            }

            clearInterval(intervalsRef.current.updateRangesInterval!);
            intervalsRef.current.updateRangesInterval = null;
          }
        }
      }
    }
  }, 200);
}