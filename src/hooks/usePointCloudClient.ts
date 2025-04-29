import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';

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

interface UsePointCloudClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  selectedPointCloudTopic: string;
  material?: PointCloudMaterialOptions;
  options?: PointCloudClientOptions;
}

// Custom Hook for managing the PointCloud2 client lifecycle
export function usePointCloudClient({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  selectedPointCloudTopic,
  material = {},
  options = {},
}: UsePointCloudClientProps) {
  const pointsClient = useRef<ROS3D.PointCloud2 | null>(null);

  useEffect(() => {
    // console.log('[usePointCloudClient] Running effect. Deps:', { isRosConnected, selectedPointCloudTopic });

    // Keep track of the client created *specifically* in this effect run for targeted cleanup
    let createdClientInstance: ROS3D.PointCloud2 | null = null;

    // --- Cleanup Function --- (Moved from VisualizationPanel)
    const cleanupPointCloudClient = () => {
      const clientToClean = createdClientInstance;
      if (!clientToClean) { return; }
      // console.log(`[usePointCloudClient Cleanup] Cleaning up instance specific to this effect run.`);

      // 1. Remove wrapper object from scene
      if (ros3dViewer.current?.scene) {
        const pointsObject = (clientToClean as any)?.points?.object as THREE.Object3D | undefined;
        if (pointsObject) {
          const wrapperObject = pointsObject.parent;
          if (wrapperObject && wrapperObject !== ros3dViewer.current.scene) {
            try { ros3dViewer.current.scene.remove(wrapperObject); } catch (e) { console.error("[PC Cleanup Hook] Error removing wrapper object", e); }
          } else { console.warn("[PC Cleanup Hook] No valid parent wrapper found."); }
        } else { console.warn("[PC Cleanup Hook] No internal points object found."); }
      }

      // 2. Dispose geometry and material
      const pointsWrapper = (clientToClean as any).points;
      if (pointsWrapper && pointsWrapper.object) {
        const pointsObject = pointsWrapper.object as THREE.Points;
        if (pointsObject.geometry) { try { pointsObject.geometry.dispose(); } catch (e) { /* Suppress error */ } }
        if (pointsObject.material) {
          const material = pointsObject.material;
          if (Array.isArray(material)) { material.forEach((mat: any) => { try { if (mat.map) mat.map.dispose(); mat.dispose(); } catch (e) { /* Suppress error */ } }); }
          else { try { if (material.map) material.map.dispose(); material.dispose(); } catch (e) { /* Suppress error */ } }
        }
      }
      createdClientInstance = null; // Nullify the captured instance for this run
    };

    // --- Prerequisite Check --- (Moved from VisualizationPanel)
    if (!ros3dViewer.current || !ros || !isRosConnected || !customTFProvider.current || !selectedPointCloudTopic) {
      // console.log('[usePointCloudClient] Prerequisites not met. Cleaning up existing client (if any).');
      // Cleanup existing *main* client ref if prerequisites fail *after* it was created
      if (pointsClient.current) {
        console.log("[usePointCloudClient Prereq Cleanup] Cleaning up existing main client.");
        // Use similar cleanup logic, but target pointsClient.current directly
        const clientToClean = pointsClient.current;
        if (ros3dViewer.current?.scene) {
          const pointsObject = (clientToClean as any)?.points?.object as THREE.Object3D | undefined;
          if (pointsObject) {
            const wrapperObject = pointsObject.parent;
            if (wrapperObject && wrapperObject !== ros3dViewer.current.scene) {
              try { ros3dViewer.current.scene.remove(wrapperObject); } catch (e) { }
            }
          }
        }
        const pointsWrapper = (clientToClean as any).points;
        if (pointsWrapper && pointsWrapper.object) {
          const pointsObject = pointsWrapper.object as THREE.Points;
          if (pointsObject.geometry) { try { pointsObject.geometry.dispose(); } catch (e) { } }
          if (pointsObject.material) {
            const material = pointsObject.material;
            if (Array.isArray(material)) { material.forEach((mat: any) => { try { if (mat.map) mat.map.dispose(); mat.dispose(); } catch (e) { } }); }
            else { try { if (material.map) material.map.dispose(); material.dispose(); } catch (e) { } }
          }
        }
        pointsClient.current = null; // Nullify the main ref
      }
      return; // Exit effect if prerequisites aren't met
    }

    // --- Cleanup Previous Client --- (Moved from VisualizationPanel)
    // If the effect re-runs due to dependency changes, clean the *previous* main client instance
    if (pointsClient.current) {
      console.log(`[usePointCloudClient] Dependencies changed. Cleaning up previous main client.`);
      // Temporarily assign the main ref to createdClientInstance for cleanup
      createdClientInstance = pointsClient.current;
      cleanupPointCloudClient(); // Run the standard cleanup for the *previous* instance
      createdClientInstance = null; // Reset captured instance
      pointsClient.current = null; // Nullify the main ref before creating the new one
    }

    // --- Create New Client --- (Moved from VisualizationPanel)
    console.log(`[usePointCloudClient] Creating new client for topic: ${selectedPointCloudTopic}`);
    
    // Create custom material with shader modifications for axis coloring
    let customMaterial: THREE.Material | undefined = undefined;
    
    // Check if we need to use axis-based coloring
    if (material.colorMode && material.minAxisValue !== undefined && material.maxAxisValue !== undefined) {
      const minValue = material.minAxisValue;
      const maxValue = material.maxAxisValue;
      const axisIndex = material.colorMode === 'x' ? 0 : (material.colorMode === 'y' ? 1 : 2);
      const minColor = material.minColor || new THREE.Color(0x0000ff); // Default blue
      const maxColor = material.maxColor || new THREE.Color(0xff0000); // Default red
      
      // Create a custom shader material for axis-based coloring - FIXED to avoid attribute/uniform redefinition
      customMaterial = new THREE.ShaderMaterial({
        vertexShader: `
          // Custom shader for point cloud coloring by axis position
          varying vec3 vColor;
          
          void main() {
            // Position calculation using pre-defined attributes/uniforms
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = ${material.size || 0.05} * 10.0;
            
            // Color calculation based on position
            float value = position[${axisIndex}];
            float normalized = clamp((value - ${minValue.toFixed(1)}) / (${maxValue.toFixed(1)} - ${minValue.toFixed(1)}), 0.0, 1.0);
            
            // Linear interpolation between min and max colors
            vec3 minCol = vec3(${minColor.r.toFixed(4)}, ${minColor.g.toFixed(4)}, ${minColor.b.toFixed(4)});
            vec3 maxCol = vec3(${maxColor.r.toFixed(4)}, ${maxColor.g.toFixed(4)}, ${maxColor.b.toFixed(4)});
            vColor = mix(minCol, maxCol, normalized);
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          
          void main() {
            // Creating a circular point
            vec2 coord = gl_PointCoord - vec2(0.5);
            if(length(coord) > 0.5)
                discard;
            
            gl_FragColor = vec4(vColor, 1.0);
          }
        `,
        transparent: true
      });
    }

    // Prepare regular material options with defaults if not using custom shader
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
      max_pts: options.maxPoints ?? 200000,
      throttle_rate: options.throttleRate ?? 100,
      compression: 'none' as const
    };

    // Add material or custom shader
    if (customMaterial) {
      clientOptions.material = customMaterial;
      clientOptions.customShader = true;
    } else {
      clientOptions.material = materialOptions;
    }

    try {
      const newClient = new ROS3D.PointCloud2(clientOptions);
      pointsClient.current = newClient; // Update the main ref for this hook
      createdClientInstance = newClient; // Capture instance for this effect run's cleanup
      
      // --- Post-Creation Logic (Intervals) --- (Moved from VisualizationPanel)
      let checkSceneInterval: ReturnType<typeof setInterval> | null = null;
      let checkPointsObjectInterval: ReturnType<typeof setInterval> | null = null;

      // Check for scene addition
      checkSceneInterval = setInterval(() => {
        if (ros3dViewer.current?.scene && createdClientInstance) { // Check captured instance too
            const internalPointsObject = (createdClientInstance as any)?.points?.object;
            const wrapperObject = internalPointsObject?.parent;
            if (wrapperObject && ros3dViewer.current.scene.children.includes(wrapperObject)) {
                // console.log(`[usePointCloudClient] New client wrapper object found in scene.`);
                if(checkSceneInterval) clearInterval(checkSceneInterval);
            } 
        } else {
           // console.warn('[usePointCloudClient] Viewer scene not available or client gone during scene check.');
           if(checkSceneInterval) clearInterval(checkSceneInterval);
        }
      }, 100);

      // Frustum culling check
      checkPointsObjectInterval = setInterval(() => {
        // Use pointsClient.current here as it persists across renders unlike createdClientInstance for this check
        if (pointsClient.current?.points?.object) {
          pointsClient.current.points.object.frustumCulled = false;
          // console.log('[usePointCloudClient Debug] Set frustumCulled = false.');
          if(checkPointsObjectInterval) clearInterval(checkPointsObjectInterval);
        }
      }, 100);

      // Cleanup function for intervals specific to THIS client instance
      const cleanupIntervals = () => {
        if(checkSceneInterval) clearInterval(checkSceneInterval);
        if(checkPointsObjectInterval) clearInterval(checkPointsObjectInterval);
      };

      // --- Combined Cleanup for This Effect Run ---
      // This runs when the component unmounts OR dependencies change
      return () => {
        // console.log('[usePointCloudClient] Running effect cleanup for this instance.');
        cleanupIntervals();
        cleanupPointCloudClient(); // Cleans the client created in *this* effect run
      };

    } catch (error) {
      console.error(`[usePointCloudClient] Error creating PointCloud2 client:`, error);
      pointsClient.current = null;
      createdClientInstance = null;
    }

    // Fallback cleanup (shouldn't be needed if try/catch returns correctly)
    return () => {
       // console.log('[usePointCloudClient] Running fallback cleanup.');
       cleanupPointCloudClient(); // Ensure cleanup if try block failed before returning
    };

    // Dependencies: Trigger effect if ROS/Viewer/TFProvider/Topic changes or if material/options change
  }, [ros, isRosConnected, ros3dViewer, customTFProvider, selectedPointCloudTopic, material, options]);

  // This hook primarily manages side effects, doesn't need to return the client ref itself
  // unless the parent component needs direct access for some reason.
  // return { pointsClient }; 
} 