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
  const frustumContainerRef = useRef<THREE.Group | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const [lastCameraInfo, setLastCameraInfo] = useState<any>(null); // Store the last received msg
  const [cameraFrameId, setCameraFrameId] = useState<string | null>(null);

  // Effect 1: Manage container AND the stable LineSegments object
  useEffect(() => {
    const viewer = ros3dViewer.current;
    let containerAdded = false;
    let linesAdded = false;

    if (isRosConnected && viewer && selectedCameraInfoTopic) {
      if (!frustumContainerRef.current) {
        // console.log('[CameraInfoViz E1] Creating container Group');
        frustumContainerRef.current = new THREE.Group();
        viewer.scene.add(frustumContainerRef.current);
        containerAdded = true;

        // Create the LineSegments object ONCE with minimal initial geometry
        // Use simpler construction approach for compatibility
        const vertices = new Float32Array(15); // 5 points, 3 components each (x,y,z)
        const initialGeometry = new THREE.BufferGeometry();
        
        // For Three.js 0.89.0, we need to create the attribute differently
        initialGeometry.addAttribute('position', new THREE.BufferAttribute(vertices, 3));
        
        // Create a minimal index array (empty frustum initially)
        initialGeometry.setIndex([]);
        
        const material = new THREE.LineBasicMaterial({ color: lineColor });
        frustumLinesRef.current = new THREE.LineSegments(initialGeometry, material);
        frustumLinesRef.current.visible = false; 
        frustumContainerRef.current.add(frustumLinesRef.current);
        linesAdded = true;
      }
    } else {
      // If disconnected or no topic, cleanup if container exists
      if (frustumContainerRef.current) {
        // console.log('[CameraInfoViz E1] Removing container (no topic/disconnected)');
        viewer?.scene.remove(frustumContainerRef.current);
        // Dispose geometry/material of the ONE LineSegments object
        frustumLinesRef.current?.geometry?.dispose();
        (frustumLinesRef.current?.material as THREE.Material)?.dispose();
        frustumContainerRef.current = null;
        frustumLinesRef.current = null;
      }
    }

    // Cleanup for Effect 1
    return () => {
       // console.log('[CameraInfoViz E1] Cleanup');
      // If container was added in THIS run, or if conditions changed, remove it
      if ((containerAdded || !isRosConnected || !selectedCameraInfoTopic) && frustumContainerRef.current) {
        // console.log('[CameraInfoViz E1] Removing container from scene');
        viewer?.scene.remove(frustumContainerRef.current);
        // Also dispose geometry/material of the single LineSegments object
        frustumLinesRef.current?.geometry?.dispose();
        (frustumLinesRef.current?.material as THREE.Material)?.dispose();
        frustumContainerRef.current = null;
        frustumLinesRef.current = null;
      }
    };
  }, [isRosConnected, selectedCameraInfoTopic, ros3dViewer, lineColor]); // Add lineColor dependency for material

  // Effect 2: Manage CameraInfo Subscription
  useEffect(() => {
    const cleanupSubscription = () => {
      if (cameraInfoSub.current) {
        // console.log(`[CameraInfoViz E2] Unsubscribing from ${cameraInfoSub.current.name}`);
        cameraInfoSub.current.unsubscribe();
        cameraInfoSub.current = null;
        setLastCameraInfo(null); // Clear last message -> triggers Effect 3 to hide lines
        setCameraFrameId(null);
        // --- REMOVED direct disposal of lines/geometry here --- 
      }
    };

    // Subscribe logic (remains mostly the same)
    if (ros && isRosConnected && selectedCameraInfoTopic && frustumContainerRef.current /*&& frustumLinesRef.current*/) {
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
        if(frame) setCameraFrameId(frame.startsWith('/') ? frame.substring(1) : frame);
      });
      cameraInfoSub.current = sub;
    } else {
      cleanupSubscription(); 
    }

    return cleanupSubscription;

  }, [ros, isRosConnected, selectedCameraInfoTopic, frustumContainerRef]); // Removed frustumLinesRef dependency

  // Effect 3: Update Frustum Geometry based on last CameraInfo
  useEffect(() => {
      const lines = frustumLinesRef.current; 
      if (!lines || !lines.geometry) {
          return; 
      }

      if (!lastCameraInfo) {
        lines.visible = false;
        return;
      }

      // --- Calculate New Points --- 
      const K = lastCameraInfo.k; 
      const width = lastCameraInfo.width;
      const height = lastCameraInfo.height;
      if (!K || K.length < 6 || !width || !height) {
          console.warn('[CameraInfoViz E3] Invalid CameraInfo received, hiding lines:', lastCameraInfo);
          lines.visible = false; 
          return;
      }
      const fx = K[0];
      const fy = K[4];
      const cx = K[2];
      const cy = K[5];
      const Z = lineScale;
      
      // Define frustum points and indices
      const points = [
          [0, 0, 0], 
          [((0 - cx) * Z) / fx, ((0 - cy) * Z) / fy, Z], 
          [((width - cx) * Z) / fx, ((0 - cy) * Z) / fy, Z], 
          [((width - cx) * Z) / fx, ((height - cy) * Z) / fy, Z], 
          [((0 - cx) * Z) / fx, ((height - cy) * Z) / fy, Z], 
      ];
      const indices = [ 0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1 ];
      
      // Direct update of the position buffer
      const positionArray = lines.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < points.length; i++) {
        const baseIndex = i * 3;
        positionArray[baseIndex] = points[i][0];
        positionArray[baseIndex + 1] = points[i][1];
        positionArray[baseIndex + 2] = points[i][2];
      }
      lines.geometry.attributes.position.needsUpdate = true;
      
      // Update indices
      lines.geometry.setIndex(indices);
      
      // Update material color
      (lines.material as THREE.LineBasicMaterial).color.set(lineColor);
      
      // Show the lines
      lines.visible = true;

  }, [lastCameraInfo, lineColor, lineScale]);

  // Effect 4: Update Frustum Container Pose using TF (remains the same)
  useEffect(() => {
    const updatePose = () => {
      const viewer = ros3dViewer.current;
      const provider = customTFProvider.current;
      const container = frustumContainerRef.current; // Use the container

      // Ensure container and frameId exist
      if (!isRosConnected || !viewer || !provider || !container || !cameraFrameId) {
        animationFrameId.current = requestAnimationFrame(updatePose);
        return;
      }

      const fixedFrame = viewer.fixedFrame || 'odom';
      const transform = provider.lookupTransform(cameraFrameId, fixedFrame);

      if (transform) {
        container.position.copy(transform.translation);
        container.quaternion.copy(transform.rotation);
        container.visible = true; // Container visibility (might be redundant if lines visibility is handled)
      } else {
        container.visible = false; 
      }
      animationFrameId.current = requestAnimationFrame(updatePose);
    };

    if (isRosConnected && cameraFrameId && frustumContainerRef.current) {
        animationFrameId.current = requestAnimationFrame(updatePose);
    } else {
        if(animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
    }

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isRosConnected, ros3dViewer, customTFProvider, cameraFrameId]);

} 