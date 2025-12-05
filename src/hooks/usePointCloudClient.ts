import React, { useEffect, useRef } from 'react';
import { Ros } from 'roslib';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';

// Platform detection utilities
const isIOS = (): boolean => {
  return (
    typeof navigator !== 'undefined' && 
    /iPad|iPhone|iPod/.test(navigator.userAgent) && 
    !(window as any).MSStream
  );
};

const isMobile = (): boolean => {
  return (
    typeof navigator !== 'undefined' && 
    (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
    (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 2))
  );
};

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
    x: {min: number, max: number},
    y: {min: number, max: number},
    z: {min: number, max: number}
  }>({
    x: {min: 0, max: 0},
    y: {min: 0, max: 0},
    z: {min: 0, max: 0}
  });
  
  // Track intervals at the hook level (outside the effect) so they can be accessed in the material update code
  const intervalsRef = useRef<{
    checkSceneInterval: ReturnType<typeof setInterval> | null,
    checkPointsObjectInterval: ReturnType<typeof setInterval> | null,
    updateRangesInterval: ReturnType<typeof setInterval> | null
  }>({
    checkSceneInterval: null,
    checkPointsObjectInterval: null,
    updateRangesInterval: null
  });

  useEffect(() => {
    console.log('[usePointCloudClient] Running effect. Deps:', { 
      isRosConnected, 
      selectedPointCloudTopic, 
      fixedFrame,  // Log fixedFrame to show changes
      materialChanged: !!material 
    });

    // Keep track of the client created *specifically* in this effect run for targeted cleanup
    let createdClientInstance: ROS3D.PointCloud2 | null = null;

    // --- Cleanup Function --- (Safer and more defensive)
    const cleanupPointCloudClient = () => {
      // Get the instance to clean and verify it exists
      const clientToClean = createdClientInstance;
      if (!clientToClean) { 
        console.log("[PC Cleanup] No client to clean");
        return; 
      }
      
      console.log("[PC Cleanup] Starting cleanup for point cloud");
      
      try {
        // Try to unsubscribe from the topic first to stop incoming data
        if (typeof (clientToClean as any).unsubscribe === 'function') {
          (clientToClean as any).unsubscribe();
          console.log("[PC Cleanup] Unsubscribed from topic");
        }
      } catch (e) {
        console.warn("[PC Cleanup] Error unsubscribing from topic:", e);
      }
      
      try {
        // Remove from scene if possible
        if (ros3dViewer.current?.scene) {
          // Get the point wrapper parent (should be the object directly in the scene)
          let objectInScene = null;
          
          // First approach - via points.object.parent
          const pointsObj = (clientToClean as any)?.points?.object;
          if (pointsObj && pointsObj.parent) {
            objectInScene = pointsObj.parent;
          }
          
          // Second approach - try to find the object directly
          if (!objectInScene && (clientToClean as any).rootObject) {
            objectInScene = (clientToClean as any).rootObject;
          }
          
          // Remove the object if found
          if (objectInScene && ros3dViewer.current.scene.children.includes(objectInScene)) {
            ros3dViewer.current.scene.remove(objectInScene);
            console.log("[PC Cleanup] Removed object from scene");
          }
        }
      } catch (e) {
        console.warn("[PC Cleanup] Error removing from scene:", e);
      }
      
      try {
        // Clean up any THREE.js objects (less aggressively)
        const pointsObj = (clientToClean as any)?.points?.object;
        if (pointsObj) {
          // Set to invisible first
          pointsObj.visible = false;
            
          // Clear material references
          if (pointsObj.material) {
            // Simpler material disposal - avoid trying to dispose internal properties
            if (Array.isArray(pointsObj.material)) {
              pointsObj.material.forEach((mat: THREE.Material) => {
                if (mat && typeof mat.dispose === 'function') {
                  mat.dispose();
                }
              });
            } else if (typeof pointsObj.material.dispose === 'function') {
              pointsObj.material.dispose();
            }
            
            // Explicitly null the material
            pointsObj.material = null;
          }
            
          // Clean up the geometry 
          if (pointsObj.geometry && typeof pointsObj.geometry.dispose === 'function') {
            // Simple dispose without trying to clear internal arrays
            pointsObj.geometry.dispose();
            pointsObj.geometry = null;
          }
        }
      } catch (e) {
        console.warn("[PC Cleanup] Error cleaning up THREE.js objects:", e);
      }
      
      // Clear any client references
      if ((clientToClean as any).points) {
        (clientToClean as any).points = null;
      }
      
      // Final cleanup
      createdClientInstance = null;
      console.log("[PC Cleanup] Cleanup complete");
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

    // Check if we're just changing color scheme - the previous approach doesn't work properly
    // because pointsClient.current.topicName is undefined in the ROS3D type definitions
    const currentTopic = pointsClient.current ? ((pointsClient.current as any).topicName || 
                                                (pointsClient.current as any).topic || '') : '';
                                                
    const isJustColorChange = pointsClient.current && 
                           ros && isRosConnected &&
                           // Use the safely accessed topic name
                           selectedPointCloudTopic === currentTopic;
    
    console.log(`[usePointCloudClient] Change type check: selectedTopic=${selectedPointCloudTopic}, 
        currentTopic=${currentTopic}, 
        isJustColorChange=${isJustColorChange}`);
    
    // If we're just changing color settings on the same topic, handle it differently
    if (isJustColorChange) {
      console.log(`[usePointCloudClient] Detected color scheme change on same topic. Using direct update.`);
      
      try {
        // Get the existing point cloud object
        const pointsObj = (pointsClient.current as any)?.points?.object;
        
        // Check for points and material - proceed only if both exist
        if (pointsObj && pointsObj.material) {
          console.log("[Color Change] Updating shader material without recreating client");
          
          // Store its visibility state
          const wasVisible = pointsObj.visible;
          
          // Create the updated shader parameters
          const axisIndex = material.colorMode === 'x' ? 0 : (material.colorMode === 'y' ? 1 : 2);
          const minColor = material.minColor || new THREE.Color(0x0000ff);
          const maxColor = material.maxColor || new THREE.Color(0xff0000);
          
          // Get safe initial values for the shader uniforms
          const safeInitialMin = (material.minAxisValue !== undefined) ? material.minAxisValue : -10;
          const safeInitialMax = (material.maxAxisValue !== undefined) ? material.maxAxisValue : 10;
          
          // Ensure the range is valid
          const safeMin = Math.min(safeInitialMin, safeInitialMax - 0.001);
          const safeMax = Math.max(safeInitialMax, safeInitialMin + 0.001);
          
          console.log(`[PointCloudClient] Updating color scheme to ${material.colorMode} axis`);
          
          // Create a new shader material - more reliable than updating the existing one
          const newMaterial = new THREE.ShaderMaterial({
            vertexShader: `
              varying vec3 vColor;
              uniform float minAxisValue;
              uniform float maxAxisValue;
              
              void main() {
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = ${material.size || 0.05} * ${isMobile() ? 8.0 : 10.0};
                
                float value = position[${axisIndex}];
                float normalized = clamp((value - minAxisValue) / (maxAxisValue - minAxisValue), 0.0, 1.0);
                
                vec3 minCol = vec3(${minColor.r.toFixed(4)}, ${minColor.g.toFixed(4)}, ${minColor.b.toFixed(4)});
                vec3 maxCol = vec3(${maxColor.r.toFixed(4)}, ${maxColor.g.toFixed(4)}, ${maxColor.b.toFixed(4)});
                vColor = mix(minCol, maxCol, normalized);
              }
            `,
            fragmentShader: isMobile() ? `
              varying vec3 vColor;
              
              void main() {
                // Create a smoother circular point
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                
                // Use a quadratic falloff for smoother edges without square artifacts
                float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
                
                // Hard cutoff without alpha blending
                if(dist > 0.48) discard;
                
                // Full opacity to avoid blending issues
                gl_FragColor = vec4(vColor, 1.0);
              }
            ` : `
              varying vec3 vColor;
              
              void main() {
                // Higher quality rendering for desktop
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                
                // Smoother edge
                float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
                if(alpha < 0.1) discard;
                
                gl_FragColor = vec4(vColor, 1.0);
              }
            `,
            transparent: false,
            blending: THREE.NoBlending,
            depthTest: true,
            depthWrite: true,
            uniforms: {
              minAxisValue: { value: safeMin },
              maxAxisValue: { value: safeMax }
            }
          });
          
          // Dispose of the old material to prevent memory leaks
          if (pointsObj.material) {
            try {
              if (typeof pointsObj.material.dispose === 'function') {
                pointsObj.material.dispose();
              }
            } catch (e) {
              console.warn("[Color Change] Error disposing old material:", e);
            }
          }
          
          // Apply the new material
          pointsObj.material = newMaterial;
          pointsObj.material.needsUpdate = true;
          
          // Keep visibility state
          pointsObj.visible = wasVisible;
          
          // Force render update to show changes
          if (ros3dViewer.current?.renderer) {
            ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
            
            // Schedule another render for next frame to ensure changes are applied
            requestAnimationFrame(() => {
              if (ros3dViewer.current?.renderer) {
                ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
              }
            });
          }
          
          // Skip creating a new client by returning a cleanup function
          return () => {
            if (intervalsRef.current.updateRangesInterval) {
              clearInterval(intervalsRef.current.updateRangesInterval);
              intervalsRef.current.updateRangesInterval = null;
            }
          };
        }
      } catch (error) {
        console.error("[usePointCloudClient] Error updating color scheme:", error);
        // If color change fails, fall through to the regular creation process
      }
    }
    
    // --- Only clean up previous client if we're actually changing topics ---
    if (pointsClient.current && !isJustColorChange) {
      console.log(`[usePointCloudClient] Topic changed. Cleaning up previous client.`);
      // Temporarily assign the main ref to createdClientInstance for cleanup
      createdClientInstance = pointsClient.current;
      cleanupPointCloudClient(); // Run the standard cleanup for the *previous* instance
      createdClientInstance = null; // Reset captured instance
      pointsClient.current = null; // Nullify the main ref before creating the new one
    }

    // Check if we're changing fixed frame - force recreation in this case
    const isFixedFrameChange = pointsClient.current && 
                        ros && isRosConnected &&
                        // If the client already exists but the fixed frame changed
                        fixedFrame !== ((pointsClient.current as any)._fixedFrame || '');
                                                
    if (isFixedFrameChange) {
      console.log(`[usePointCloudClient] Fixed frame changed from ${(pointsClient.current as any)._fixedFrame} to ${fixedFrame}. Recreating client.`);
      
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
    if (material.colorMode) {
      const axisIndex = material.colorMode === 'x' ? 0 : (material.colorMode === 'y' ? 1 : 2);
      const minColor = material.minColor || new THREE.Color(0x0000ff); // Default blue
      const maxColor = material.maxColor || new THREE.Color(0xff0000); // Default red

      // Use default ranges initially, they will be updated dynamically
      const initialMinValue = material.minAxisValue !== undefined ? material.minAxisValue : -10;
      const initialMaxValue = material.maxAxisValue !== undefined ? material.maxAxisValue : 10;
      
      // Create a custom shader material with cross-browser compatibility
      const isIOSDevice = isIOS();
      const isMobileDevice = isMobile();
      
      // Get safe initial values for the shader uniforms
      const safeInitialMin = (material.minAxisValue !== undefined) ? material.minAxisValue : -10;
      const safeInitialMax = (material.maxAxisValue !== undefined) ? material.maxAxisValue : 10;
      
      // Ensure the range is valid (Chrome is especially sensitive to this)
      const safeMin = Math.min(safeInitialMin, safeInitialMax - 0.001);
      const safeMax = Math.max(safeInitialMax, safeInitialMin + 0.001);
      
      console.log(`[PointCloudClient] Creating shader for ${material.colorMode} axis with range: [${safeMin}, ${safeMax}]`);
      
      // Set up different shaders for mobile vs desktop
      let fragmentShaderCode;
      
      if (isMobileDevice) {
        // Improved mobile shader that eliminates square artifacts
        fragmentShaderCode = `
          varying vec3 vColor;
          
          void main() {
            // Create a smoother circular point
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            
            // Use a quadratic falloff for smoother edges without square artifacts
            float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
            
            // Hard cutoff without alpha blending
            if(dist > 0.48) discard;
            
            // Full opacity to avoid blending issues
            gl_FragColor = vec4(vColor, 1.0);
          }
        `;
      } else if (isIOSDevice) {
        // iOS-specific shader with improved point rendering
        fragmentShaderCode = `
          varying vec3 vColor;
          
          void main() {
            // Higher precision distance calculation
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            
            // Hard edge with slight smoothing to prevent pixelation
            float alpha = 1.0 - step(0.48, dist);
            if(alpha <= 0.01) discard;
            
            // No transparency
            gl_FragColor = vec4(vColor, 1.0);
          }
        `;
      } else {
        // Standard shader for desktop platforms
        fragmentShaderCode = `
          varying vec3 vColor;
          
          void main() {
            // Higher quality rendering for desktop
            vec2 coord = gl_PointCoord - vec2(0.45, 0.5);
            float dist = length(coord);
            
            // Smoother edge
            float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
            if(alpha < 0.1) discard;
            
            gl_FragColor = vec4(vColor, 1.0);
          }
        `;
      }
      
      // Adjust point size based on platform
      const pointSizeMultiplier = isMobileDevice ? 8.0 : 10.0;
      
      customMaterial = new THREE.ShaderMaterial({
        vertexShader: `
          // Custom shader for point cloud coloring by axis position
          varying vec3 vColor;
          uniform float minAxisValue;
          uniform float maxAxisValue;
          
          void main() {
            // Position calculation using pre-defined attributes/uniforms
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            
            // Adjust point size based on platform
            gl_PointSize = ${material.size || 0.05} * ${pointSizeMultiplier};
            
            // Color calculation based on position
            float value = position[${axisIndex}];
            float normalized = clamp((value - minAxisValue) / (maxAxisValue - minAxisValue), 0.0, 1.0);
            
            // Linear interpolation between min and max colors
            vec3 minCol = vec3(${minColor.r.toFixed(4)}, ${minColor.g.toFixed(4)}, ${minColor.b.toFixed(4)});
            vec3 maxCol = vec3(${maxColor.r.toFixed(4)}, ${maxColor.g.toFixed(4)}, ${maxColor.b.toFixed(4)});
            vColor = mix(minCol, maxCol, normalized);
          }
        `,
        fragmentShader: fragmentShaderCode,
        transparent: false, // Set to false to prevent transparency issues
        blending: THREE.NoBlending, // Use NoBlending for mobile to avoid white edges
        depthTest: true,
        depthWrite: true, // Enable depth write for proper occlusion
        uniforms: {
          minAxisValue: { value: safeMin },
          maxAxisValue: { value: safeMax }
        }
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
      max_pts: options.maxPoints ?? (isMobile() ? 100000 : 200000), // Lower point count on mobile
      // Use faster throttle rate for smoother updates - 30Hz across all platforms
      throttle_rate: options.throttleRate ?? 33, // ~30Hz on all platforms
      compression: 'cbor' as const, // Use compression for faster transfer
      queue_size: 1, // Only keep latest message to reduce latency
      
      // ***IMPORTANT: Always explicitly set the fixed frame***
      fixedFrame: fixedFrame,
      
      // Add a custom message handler wrapper to catch errors
      messageHandler: function(message: any) {
        try {
          // Store the fixed frame in a property for easy access
          this.fixedFrame = fixedFrame;
          
          // SAFETY CHECK: Ensure lookupTransform is available
          if (!this.tfClient || typeof this.tfClient.lookupTransform !== 'function') {
            console.warn('[PointCloud2] TF Client missing or lookupTransform not available');
            return;
          }
          
          // Process the message if all checks pass
          if (message.header && message.header.frame_id) {
            // Safe call to process message
            try {
              this.processMessage(message);
            } catch (error) {
              console.error('[PointCloud2] Error in processMessage:', error);
            }
          } else {
            console.warn('[PointCloud2] Message missing header or frame_id');
          }
        } catch (error) {
          console.error('[PointCloud2] Unhandled error in message handler:', error);
        }
      }
    };

    // Add material or custom shader
    if (customMaterial) {
      clientOptions.material = customMaterial;
      clientOptions.customShader = true;
      
      // Platform-specific optimizations
      if (isMobile()) {
        console.log("[Mobile] Applying mobile-specific optimizations for point cloud");
        // Use simpler rendering on mobile
        clientOptions.max_pts = Math.min(options.maxPoints ?? 100000, 50000);
        
        // iOS-specific additional optimizations
        if (isIOS()) {
          console.log("[iOS] Applying additional iOS-specific optimizations");
          clientOptions.max_pts = Math.min(clientOptions.max_pts, 30000);
          // Keep 30Hz for iOS too - throttle_rate already set above
        }
      }
    } else {
      clientOptions.material = materialOptions;
    }

    try {
      const newClient = new ROS3D.PointCloud2(clientOptions);
      
      // Store the fixed frame in a private property for change detection
      (newClient as any)._fixedFrame = fixedFrame;
      
      // Verify the client was created properly - this helps catch potential issues
      if (!(newClient as any).points || !(newClient as any).points.setup) {
        console.warn("[usePointCloudClient] WARNING: Points object not properly initialized, will attempt recovery");
        
        // Try to safely reset points using our patched method
        if (typeof (newClient as any).safeResetPoints === 'function') {
          console.log("[usePointCloudClient] Using patched safeResetPoints for recovery");
          const success = (newClient as any).safeResetPoints();
          console.log(`[usePointCloudClient] Recovery ${success ? 'successful' : 'failed'}`);
        } else {
          // Fallback to old method
          setTimeout(() => {
            if (pointsClient.current && !(pointsClient.current as any).points) {
              console.log("[usePointCloudClient] Attempting to manually initialize points");
              try {
                // Attempt manual initialization - this depends on ROS3D implementation
                (pointsClient.current as any).initializePoints();
              } catch (e) {
                console.error("[usePointCloudClient] Failed to manually initialize points:", e);
              }
            }
          }, 500); // Delayed initialization attempt
        }
      } else {
        console.log("[usePointCloudClient] Points object properly initialized");
      }
      
      pointsClient.current = newClient; // Update the main ref for this hook
      createdClientInstance = newClient; // Capture instance for this effect run's cleanup
      
      // If an external ref was provided, update it too
      if (clientRef) {
        clientRef.current = newClient;
      }
      
      // Add a short delay before allowing message processing
      // This gives the points object time to be fully set up
      setTimeout(() => {
        if (pointsClient.current) {
          console.log("[usePointCloudClient] Initialization delay complete, client ready for messages");
          // Force a render to ensure visibility
          if (ros3dViewer.current?.renderer) {
            ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
          }
        }
      }, 300);

      // --- Post-Creation Logic (Intervals) --- (Moved from VisualizationPanel)
      // Clear any existing intervals
      if (intervalsRef.current.checkSceneInterval) {
        clearInterval(intervalsRef.current.checkSceneInterval);
        intervalsRef.current.checkSceneInterval = null;
      }
      if (intervalsRef.current.checkPointsObjectInterval) {
        clearInterval(intervalsRef.current.checkPointsObjectInterval);
        intervalsRef.current.checkPointsObjectInterval = null;
      }
      if (intervalsRef.current.updateRangesInterval) {
        clearInterval(intervalsRef.current.updateRangesInterval);
        intervalsRef.current.updateRangesInterval = null;
      }

      // Check for scene addition
      intervalsRef.current.checkSceneInterval = setInterval(() => {
        if (ros3dViewer.current?.scene && createdClientInstance) { // Check captured instance too
            const internalPointsObject = (createdClientInstance as any)?.points?.object;
            const wrapperObject = internalPointsObject?.parent;
            if (wrapperObject && ros3dViewer.current.scene.children.includes(wrapperObject)) {
                // console.log(`[usePointCloudClient] New client wrapper object found in scene.`);
                if(intervalsRef.current.checkSceneInterval) clearInterval(intervalsRef.current.checkSceneInterval);
            } 
        } else {
           // console.warn('[usePointCloudClient] Viewer scene not available or client gone during scene check.');
           if(intervalsRef.current.checkSceneInterval) clearInterval(intervalsRef.current.checkSceneInterval);
        }
      }, 100);

      // Frustum culling check
      intervalsRef.current.checkPointsObjectInterval = setInterval(() => {
        // Use pointsClient.current here as it persists across renders unlike createdClientInstance for this check
        if (pointsClient.current?.points?.object) {
          pointsClient.current.points.object.frustumCulled = false;
          // console.log('[usePointCloudClient Debug] Set frustumCulled = false.');
          if(intervalsRef.current.checkPointsObjectInterval) clearInterval(intervalsRef.current.checkPointsObjectInterval);
        }
      }, 100);

      // Update axis ranges dynamically with better visibility handling
      if (customMaterial && material.colorMode) {
        // Set initial opacity low but keep points visible
        if (pointsClient.current?.points?.object) {
          const pointsObj = pointsClient.current.points.object as THREE.Points;
          if (pointsObj.material) {
            // Use low but visible opacity while ranges are calculated
            (pointsObj.material as THREE.ShaderMaterial).opacity = 0.3;
            // Always keep visible - hiding completely causes issues
            pointsObj.visible = true;
          }
        }

        let rangeCalculated = false;
        let retryCount = 0;
        const maxRetries = 10;

        intervalsRef.current.updateRangesInterval = setInterval(() => {
          if (pointsClient.current?.points?.object) {
            const pointsObj = pointsClient.current.points.object as THREE.Points;
            const geometry = pointsObj.geometry as THREE.BufferGeometry;
            const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
            
            if (positions && positions.count > 0) {
              const axisIndex = material.colorMode === 'x' ? 0 : (material.colorMode === 'y' ? 1 : 2);
              let min = Infinity;
              let max = -Infinity;
              
              // More comprehensive sampling strategy - check more points initially
              // to get a better initial range
              const sampleCount = Math.min(positions.count, 1000); // Check up to 1000 points
              const sampleStep = Math.max(1, Math.floor(positions.count / sampleCount));
              
              for (let i = 0; i < positions.count; i += sampleStep) {
                // Use proper position access based on axis
                let val;
                if (axisIndex === 0) val = positions.getX(i);
                else if (axisIndex === 1) val = positions.getY(i);
                else val = positions.getZ(i);
                
                if (isFinite(val)) {
                  if (val < min) min = val;
                  if (val > max) max = val;
                }
              }
              
              // Only update if we found valid values and they're different from current ones
              if (isFinite(min) && isFinite(max) && max > min) {
                const shader = (pointsObj.material as THREE.ShaderMaterial);
                if (shader && shader.uniforms) {
                  // Add small padding to range (5%)
                  const range = max - min;
                  const padding = range * 0.05;
                  
                  // Apply the changes - ensure we modify them properly and avoid invalid values
                  const safeMin = min - padding;
                  const safeMax = Math.max(max + padding, safeMin + 0.001); // Ensure range is non-zero
                  
                  shader.uniforms.minAxisValue.value = safeMin;
                  shader.uniforms.maxAxisValue.value = safeMax;
                  
                  // For Chrome, force the uniforms to update by explicitly assigning new objects
                  shader.uniforms.minAxisValue = { value: safeMin, type: 'f' };
                  shader.uniforms.maxAxisValue = { value: safeMax, type: 'f' };
                  
                  // Now we have good values, make points fully visible
                  if (!rangeCalculated) {
                    if (pointsClient.current?.points?.object) {
                      const pointsObj = pointsClient.current.points.object as THREE.Points;
                      
                      // Safely update the material
                      if (pointsObj.material) {
                        const material = pointsObj.material as THREE.ShaderMaterial;
                        
                        // Increase opacity to full
                        material.opacity = 1.0;
                        material.needsUpdate = true; // Important! Force material update
                        
                        // Make sure shader is ready
                        if (material.program) {
                          // Program is ready - no need for special handling
                        } else {
                          // Force shader program compilation
                          const renderer = ros3dViewer.current?.renderer;
                          if (renderer) {
                            renderer.compile(ros3dViewer.current.scene, ros3dViewer.current.camera);
                          }
                        }
                        
                        // Force a render update with 2 frames to ensure it's visible
                        if (ros3dViewer.current?.renderer) {
                          // Render immediately
                          ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                          
                          // Schedule another render for next frame
                          requestAnimationFrame(() => {
                            if (ros3dViewer.current?.renderer) {
                              ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                            }
                          });
                        }
                      }
                    }
                    rangeCalculated = true;
                  }
                  
                  // Update our stored ranges for future reference
                  if (material.colorMode === 'x') {
                    axisRanges.current.x = {min, max};
                  } else if (material.colorMode === 'y') {
                    axisRanges.current.y = {min, max};
                  } else if (material.colorMode === 'z') {
                    axisRanges.current.z = {min, max};
                  }
                  
                  // Once we have good values, stop checking
                  clearInterval(intervalsRef.current.updateRangesInterval!);
                  intervalsRef.current.updateRangesInterval = null;
                }
              } else {
                retryCount++;
                if (retryCount >= maxRetries) {
                  // If we can't find good values after several tries, show points with default ranges
                  if (pointsClient.current?.points?.object) {
                    const pointsObj = pointsClient.current.points.object as THREE.Points;
                    const shader = (pointsObj.material as THREE.ShaderMaterial);
                    
                    // Use safe default values for the axis
                    if (shader && shader.uniforms) {
                      shader.uniforms.minAxisValue.value = -10;
                      shader.uniforms.maxAxisValue.value = 10;
                    }
                    
                    // Make visible with high opacity and force update
                    pointsObj.material.opacity = 1.0;
                    pointsObj.material.needsUpdate = true;
                    pointsObj.visible = true;
                    
                    // Force a render update with two frames
                    if (ros3dViewer.current?.renderer) {
                      // First render
                      ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                      
                      // Schedule another render
                      requestAnimationFrame(() => {
                        if (ros3dViewer.current?.renderer) {
                          ros3dViewer.current.renderer.render(ros3dViewer.current.scene, ros3dViewer.current.camera);
                        }
                      });
                    }
                  }
                  clearInterval(intervalsRef.current.updateRangesInterval!);
                  intervalsRef.current.updateRangesInterval = null;
                }
              }
            }
          }
        }, 200); // Check more frequently for better user experience
      }

      // Cleanup function for intervals specific to THIS client instance
      const cleanupIntervals = () => {
        if(intervalsRef.current.checkSceneInterval) {
          clearInterval(intervalsRef.current.checkSceneInterval);
          intervalsRef.current.checkSceneInterval = null;
        }
        if(intervalsRef.current.checkPointsObjectInterval) {
          clearInterval(intervalsRef.current.checkPointsObjectInterval);
          intervalsRef.current.checkPointsObjectInterval = null;
        }
        if(intervalsRef.current.updateRangesInterval) {
          clearInterval(intervalsRef.current.updateRangesInterval);
          intervalsRef.current.updateRangesInterval = null;
        }
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

    // Dependencies: Trigger effect if ROS/Viewer/TFProvider/Topic changes or if material/options change or fixedFrame changes
  }, [ros, isRosConnected, ros3dViewer, customTFProvider, selectedPointCloudTopic, material, options, fixedFrame]);

  // Update return value to include the client
  return { 
    axisRanges: axisRanges.current,
    pointCloudClient: pointsClient.current 
  }; 
} 