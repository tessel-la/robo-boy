import React, { useEffect, useRef, useState } from 'react';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';

interface UseCameraInfoVisualizerProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  selectedCameraInfoTopic: string | null; // The selected CameraInfo topic name
  lineColor?: THREE.Color | number | string; // Optional color for the frustum lines
  lineScale?: number; // Optional scaling factor for frustum size (e.g., length of pyramid)
}

const DEFAULT_LINE_COLOR = 0x00ff00; // Green
const DEFAULT_LINE_SCALE = 1.0; // Default distance for frustum projection plane

// Static rotation to align ROS camera frame (Z forward, X right, Y down)
// with Three.js default view (Z backward, X right, Y up)
// Apply -90deg rotation around X, then +90deg around Z
const CAMERA_FRAME_ROTATION = new THREE.Quaternion(); //.multiplyQuaternions(rotZ);

export function useCameraInfoVisualizer({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  selectedCameraInfoTopic,
  lineColor = DEFAULT_LINE_COLOR,
  lineScale = DEFAULT_LINE_SCALE,
}: UseCameraInfoVisualizerProps) {
  const cameraInfoSub = useRef<ROSLIB.Topic | null>(null);
  const frustumLinesRef = useRef<THREE.LineSegments | null>(null);
  const frustumContainerRef = useRef<THREE.Group | null>(null); // Container for lines + pose
  const [lastCameraInfo, setLastCameraInfo] = useState<any>(null); // Store the last received msg
  const [cameraFrameId, setCameraFrameId] = useState<string | null>(null);
  const animationFrameId = useRef<number | null>(null); // ADDED: For animation loop

  // Effect 1: Manage Frustum Container and LineSegments Object
  useEffect(() => {
    const viewer = ros3dViewer.current;
    let containerCreated = false;
    // let linesCreated = false; // Not strictly needed for cleanup logic

    // Only create if connected and topic selected (TF handled separately)
    if (isRosConnected && viewer && selectedCameraInfoTopic) {
      if (!frustumContainerRef.current) {
        // console.log('[CameraInfoViz E1] Creating container Group');
        frustumContainerRef.current = new THREE.Group();
        frustumContainerRef.current.visible = false; // Initially hidden until TF is applied
        viewer.scene.add(frustumContainerRef.current);
        containerCreated = true;

        // Create the LineSegments object ONCE
        if (!frustumLinesRef.current) {
           // console.log('[CameraInfoViz E1] Creating LineSegments');
          const vertices = new Float32Array(15);
          const initialGeometry = new THREE.BufferGeometry();
          // Use setAttribute instead of addAttribute for newer THREE versions
          // Reverted to addAttribute for THREE r89 compatibility
          initialGeometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
          initialGeometry.setIndex([]);
          const material = new THREE.LineBasicMaterial({ color: lineColor });
          frustumLinesRef.current = new THREE.LineSegments(initialGeometry, material);
          frustumLinesRef.current.visible = false; // Lines also initially hidden
          frustumContainerRef.current.add(frustumLinesRef.current); // Add lines to container
          // linesCreated = true;
        }
      }
      // Update line color if container already exists and color changed
      else if (frustumLinesRef.current && (frustumLinesRef.current.material as THREE.LineBasicMaterial).color.getHex() !== new THREE.Color(lineColor).getHex()) {
           (frustumLinesRef.current.material as THREE.LineBasicMaterial).color.set(lineColor);
      }

    } else {
      // Cleanup if disconnected or no topic selected
      if (frustumContainerRef.current) {
        // console.log('[CameraInfoViz E1] Removing container (disconnected/no topic)');
        viewer?.scene.remove(frustumContainerRef.current);
        frustumLinesRef.current?.geometry?.dispose();
        (frustumLinesRef.current?.material as THREE.Material)?.dispose();
        frustumContainerRef.current = null;
        frustumLinesRef.current = null;
      }
    }

    // Cleanup function for this effect run
    return () => {
      // If container was created in this run, or if prerequisites changed
      // Simplified cleanup: always attempt removal if viewer exists
      if (frustumContainerRef.current && viewer) {
         // console.log('[CameraInfoViz E1 Cleanup] Attempting container removal');
         try {
            viewer.scene.remove(frustumContainerRef.current);
            frustumLinesRef.current?.geometry?.dispose();
            (frustumLinesRef.current?.material as THREE.Material)?.dispose();
         } catch (e) {
            console.error("[CameraInfoViz E1 Cleanup] Error removing/disposing objects:", e);
         }
         // Nullify refs even if removal failed
         frustumContainerRef.current = null;
         frustumLinesRef.current = null;
      }
    };
    // Dependencies include viewer existence implicitly via ros3dViewer ref
  }, [isRosConnected, selectedCameraInfoTopic, ros3dViewer, lineColor]);

  // Effect 2: Manage CameraInfo Subscription (Sets frameId)
  useEffect(() => {
    const cleanupSubscription = () => {
      if (cameraInfoSub.current) {
        // console.log(`[CameraInfoViz E2] Unsubscribing from ${cameraInfoSub.current.name}`);
        cameraInfoSub.current.unsubscribe();
        cameraInfoSub.current = null;
        setLastCameraInfo(null);
        // Don't clear cameraFrameId here, TF effect handles cleanup based on it
      }
    };

    if (ros && isRosConnected && selectedCameraInfoTopic) {
      cleanupSubscription();
      // console.log(`[CameraInfoViz E2] Subscribing to ${selectedCameraInfoTopic}`);
      const sub = new ROSLIB.Topic({
        ros: ros,
        name: selectedCameraInfoTopic,
        messageType: 'sensor_msgs/msg/CameraInfo',
        throttle_rate: 200,
      });
      sub.subscribe((message: any) => {
        setLastCameraInfo(message);
        const frame = message.header?.frame_id;
        if (frame) {
          const cleanedFrame = frame.startsWith('/') ? frame.substring(1) : frame;
          // Use functional update with explicit type for prevFrame
          setCameraFrameId((prevFrame: string | null) => prevFrame !== cleanedFrame ? cleanedFrame : prevFrame);
        } else {
          console.warn(`[CameraInfoViz E2] Received CameraInfo message without frame_id on topic ${selectedCameraInfoTopic}`);
          setCameraFrameId(null);
        }
      });
      cameraInfoSub.current = sub;
    } else {
      cleanupSubscription();
      setCameraFrameId(null); // Clear frame ID if unsubscribing
      setLastCameraInfo(null);
    }

    return cleanupSubscription;
  }, [ros, isRosConnected, selectedCameraInfoTopic]);

  // Effect 3: Update Frustum Geometry based on last CameraInfo (Unchanged logic, updates lines object)
  useEffect(() => {
    const lines = frustumLinesRef.current;
    if (!lines || !lines.geometry) {
      return;
    }

    if (!lastCameraInfo) {
      lines.visible = false;
      return;
    }

    const K = lastCameraInfo.k;
    const width = lastCameraInfo.width;
    const height = lastCameraInfo.height;
    if (!K || K.length < 6 || !width || !height) {
      // console.warn('[CameraInfoViz E3] Invalid CameraInfo received, hiding lines:', lastCameraInfo);
      lines.visible = false;
      return;
    }
    const fx = K[0];
    const fy = K[4];
    const cx = K[2];
    const cy = K[5];
    const Z = lineScale;

    const points = [
      [0, 0, 0],
      [((0 - cx) * Z) / fx, ((0 - cy) * Z) / fy, Z],
      [((width - cx) * Z) / fx, ((0 - cy) * Z) / fy, Z],
      [((width - cx) * Z) / fx, ((height - cy) * Z) / fy, Z],
      [((0 - cx) * Z) / fx, ((height - cy) * Z) / fy, Z],
    ];
    const indices = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1];

    // Use getAttribute
    const positionAttribute = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!positionAttribute) { return; } // Guard if attribute doesn't exist
    const positionArray = positionAttribute.array as Float32Array;
    for (let i = 0; i < points.length; i++) {
      const baseIndex = i * 3;
      positionArray[baseIndex] = points[i][0];
      positionArray[baseIndex + 1] = points[i][1];
      positionArray[baseIndex + 2] = points[i][2];
    }
    positionAttribute.needsUpdate = true;

    // Use getIndex
    const indexAttribute = lines.geometry.getIndex();
    if (!indexAttribute || indexAttribute.array.length !== indices.length) {
      lines.geometry.setIndex(indices);
    }

    // Make the lines visible *only if* geometry is valid
    lines.visible = true;
     // console.log('[CameraInfoViz E3] Updated frustum geometry and made visible');

  }, [lastCameraInfo, lineScale]); // Only depends on info and scale, color handled in E1

  // Effect 4: Animation loop to update frustum pose using TF lookup
  useEffect(() => {
    const updatePose = () => {
        const viewer = ros3dViewer.current;
        const provider = customTFProvider.current;
        const container = frustumContainerRef.current;

        // Ensure all prerequisites are met
        if (!isRosConnected || !viewer || !provider || !container || !cameraFrameId) {
            if (container) container.visible = false; // Hide if prerequisites fail
            animationFrameId.current = requestAnimationFrame(updatePose); // Continue loop
            return;
        }

        const fixedFrame = viewer.fixedFrame || 'odom'; // Use viewer's fixed frame

        // Look up the transform from fixedFrame -> cameraFrameId
        // Match the logic from the corrected useTfVisualizer
        const transform = provider.lookupTransform(fixedFrame, cameraFrameId);

        if (transform && transform.translation && transform.rotation) {
            // Apply position directly (x, y, z)
            container.position.set(
                transform.translation.x,
                transform.translation.y,
                transform.translation.z
            );

            // Apply raw TF rotation combined with static camera adjustment
            const tfQuaternion = new THREE.Quaternion(
                transform.rotation.x,
                transform.rotation.y,
                transform.rotation.z,
                transform.rotation.w
            );

            // Apply TF rotation first, then the static camera adjustment
            container.quaternion.copy(tfQuaternion).multiply(CAMERA_FRAME_ROTATION);

            container.visible = true; // Make container visible
        } else {
            // console.warn(`[CameraInfoViz E4 Loop] TF lookup failed for ${cameraFrameId} relative to ${fixedFrame}`);
            container.visible = false; // Hide if transform fails
        }

        // Continue the loop
        animationFrameId.current = requestAnimationFrame(updatePose);
    };

    // Start the loop if connected and container exists
    if (isRosConnected && frustumContainerRef.current) {
        // console.log('[CameraInfoViz E4] Starting animation loop');
        animationFrameId.current = requestAnimationFrame(updatePose);
    } else {
        // console.log('[CameraInfoViz E4] Not starting animation loop (prerequisites not met)');
    }

    // Cleanup function for Effect 4: Cancel animation frame
    return () => {
        // console.log('[CameraInfoViz E4] Cleanup: Cancelling animation frame');
        if (animationFrameId.current) {
            cancelAnimationFrame(animationFrameId.current);
            animationFrameId.current = null;
        }
        // Ensure container is hidden on cleanup if it still exists
        if(frustumContainerRef.current) {
             frustumContainerRef.current.visible = false;
        }
    };
  }, [isRosConnected, ros3dViewer, customTFProvider, cameraFrameId]); // Dependencies that trigger restart of the loop

} 