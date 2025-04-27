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
// Rotate -90 degrees around X-axis
const CAMERA_FRAME_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

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
  const tfSubscriptionId = useRef<string | null>(null); // Store TF subscription ID for cleanup

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

  // Effect 4: Manage TF Subscription and Apply Pose to Container
  useEffect(() => {
    const provider = customTFProvider.current;
    const container = frustumContainerRef.current;
    const viewer = ros3dViewer.current;

    // Cleanup function for TF subscription
    const cleanupTfSubscription = () => {
      if (tfSubscriptionId.current && provider) {
        // console.log(`[CameraInfoViz E4 Cleanup] Unsubscribing TF for ID: ${tfSubscriptionId.current}`);
        try {
           provider.unsubscribe(tfSubscriptionId.current);
        } catch (e) {
            console.error("[CameraInfoViz E4 Cleanup] Error unsubscribing TF:", e);
        }
        tfSubscriptionId.current = null;
      }
      // Hide container if TF is no longer valid
      if (container) {
        container.visible = false;
      }
    };

    // Subscribe to TF if all prerequisites are met
    if (provider && container && viewer && cameraFrameId && isRosConnected) {
      // Ensure we clean up any previous subscription before creating a new one
      cleanupTfSubscription();

      // console.log(`[CameraInfoViz E4] Subscribing TF for frame: ${cameraFrameId}`);
      try {
        // Subscribe to the transform from cameraFrameId to the viewer's fixedFrame
        // Explicitly type transform as any if ROSLIB.Transform is unavailable
        tfSubscriptionId.current = provider.subscribe(cameraFrameId, (transform: any | null) => {
          if (transform && transform.translation && transform.rotation && container) {
              // console.log(`[CameraInfoViz TF Callback] Received transform for ${cameraFrameId}`);

               // Apply standard ROS to Three.js axis mapping for position directly from TF
               // ROS X (fwd) -> Three -Z
               // ROS Y (left) -> Three -X
               // ROS Z (up) -> Three Y
              container.position.set(
                  transform.translation.x,
                  transform.translation.y,
                  transform.translation.z
              );

              // Combine the TF rotation with the static camera frame rotation
              const tfQuaternion = new THREE.Quaternion(
                  transform.rotation.x,
                  transform.rotation.y,
                  transform.rotation.z,
                  transform.rotation.w
              );

              // Apply TF rotation first, then the static camera adjustment
              // Ensure the quaternion multiplication order is correct for world -> local -> static adjustment
              container.quaternion.copy(tfQuaternion).multiply(CAMERA_FRAME_ROTATION);

              container.visible = true; // Make container visible once pose is applied
          } else if (container) {
              // console.warn(`[CameraInfoViz TF Callback] Transform not available or invalid for ${cameraFrameId}, hiding container.`);
              container.visible = false; // Hide if transform is lost or invalid
          }
        });
      } catch (e) {
          console.error(`[CameraInfoViz E4] Error subscribing to TF frame ${cameraFrameId}:`, e);
          tfSubscriptionId.current = null; // Ensure ID is null if subscribe failed
          if(container) container.visible = false;
      }
    } else {
      // Cleanup if prerequisites are not met (e.g., cameraFrameId becomes null)
      cleanupTfSubscription();
    }

    // Return the cleanup function to be called on unmount or dependency change
    return cleanupTfSubscription;

  }, [customTFProvider, ros3dViewer, cameraFrameId, isRosConnected]); // Dependencies trigger TF updates

} 