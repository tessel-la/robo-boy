import { useEffect, useRef, useCallback } from 'react';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three';
import { CustomTFProvider } from '../utils/tfUtils';
import { watchMessageTransform } from '../utils/stampedTransform';

interface PoseStampedMessage {
  header: {
    stamp: {
      sec: number;
      nanosec: number;
    };
    frame_id: string;
  };
  pose: {
    position: {
      x: number;
      y: number;
      z: number;
    };
    orientation: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
  };
}

export interface PoseStampedOptions {
  visualizationType?: 'arrow' | 'axes';
  scale?: number;
  color?: string | THREE.Color;
  arrowLength?: number;
  arrowWidth?: number;
  axesSize?: number;
  showTrail?: boolean;
  maxTrailLength?: number;
  // Enable/disable flags for individual settings
  scaleEnabled?: boolean;
  colorEnabled?: boolean;
  arrowDimensionsEnabled?: boolean;
  trailEnabled?: boolean;
}

interface UsePoseStampedClientProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  topic: string;
  fixedFrame: string;
  options?: PoseStampedOptions;
  onStatus?: (status: string | null) => void;
}

export function usePoseStampedClient({
  ros,
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  topic,
  fixedFrame,
  options = {},
  onStatus,
}: UsePoseStampedClientProps) {
  const topicClientRef = useRef<ROSLIB.Topic | null>(null);
  const stopTransformRef = useRef<(() => void) | undefined>();
  const report = useRef(onStatus);
  report.current = onStatus;
  const visualizationGroupRef = useRef<THREE.Group | null>(null);
  const visualizationObjectRef = useRef<THREE.Object3D | null>(null);
  const trailPointsRef = useRef<THREE.Vector3[]>([]);
  const trailLineRef = useRef<THREE.Line | null>(null);

  // Default options with enabled flag support
  const visualizationType = options.visualizationType || 'arrow';
  const scale = (options.scaleEnabled !== false) ? (options.scale || 1.0) : 1.0;
  const color = (options.colorEnabled !== false) ? (options.color || '#00ff00') : '#00ff00';
  const arrowLength = (options.arrowDimensionsEnabled !== false) ? (options.arrowLength || 1.0) : 1.0;
  const arrowWidth = (options.arrowDimensionsEnabled !== false) ? (options.arrowWidth || 0.1) : 0.1;
  const axesSize = (options.arrowDimensionsEnabled !== false) ? (options.axesSize || 0.5) : 0.5;
  const showTrail = (options.trailEnabled === true) && (options.showTrail !== false);
  const maxTrailLength = (options.trailEnabled === true) ? (options.maxTrailLength || 50) : 50;

  // Helper function to create arrow geometry
  const createArrow = useCallback((length: number, width: number, color: string | THREE.Color) => {
    const group = new THREE.Group();
    
    const arrowMaterial = new THREE.MeshLambertMaterial({ 
      color: color instanceof THREE.Color ? color : new THREE.Color(color)
    });
    
    // Create arrow shaft (cylinder) - positioned along X axis
    const shaftGeometry = new THREE.CylinderGeometry(width * 0.3, width * 0.3, length * 0.8, 8);
    const shaft = new THREE.Mesh(shaftGeometry, arrowMaterial);
    // Rotate shaft to lie along X axis and position it
    shaft.rotateZ(-Math.PI / 2);
    shaft.position.set(length * 0.4, 0, 0);
    group.add(shaft);
    
    // Create arrow head (cone) - positioned at tip along X axis
    const headGeometry = new THREE.ConeGeometry(width, length * 0.2, 8);
    const head = new THREE.Mesh(headGeometry, arrowMaterial);
    // Rotate head to point along positive X axis and position it at the tip
    head.rotateZ(-Math.PI / 2);
    head.position.set(length * 0.9, 0, 0);
    group.add(head);
    
    return group;
  }, []);

  // Helper function to create axes
  const createAxes = useCallback((size: number) => {
    return new ROS3D.Axes({ lineSize: size });
  }, []);

  // Helper function to update trail
  const updateTrail = useCallback((position: THREE.Vector3) => {
    if (!showTrail || !ros3dViewer.current) return;

    trailPointsRef.current.push(position.clone());
    
    // Limit trail length
    if (trailPointsRef.current.length > maxTrailLength) {
      trailPointsRef.current.shift();
    }

    // Remove old trail line
    if (trailLineRef.current && visualizationGroupRef.current) {
      visualizationGroupRef.current.remove(trailLineRef.current);
      trailLineRef.current.geometry.dispose();
      (trailLineRef.current.material as THREE.Material).dispose();
    }

    // Create new trail line
    if (trailPointsRef.current.length > 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints(trailPointsRef.current);
      const material = new THREE.LineBasicMaterial({ 
        color: color instanceof THREE.Color ? color : new THREE.Color(color),
        opacity: 0.6,
        transparent: true
      });
      trailLineRef.current = new THREE.Line(geometry, material);
      
      if (visualizationGroupRef.current) {
        visualizationGroupRef.current.add(trailLineRef.current);
      }
    }
  }, [showTrail, maxTrailLength, color]);

  // Message handler
  const handlePoseStampedMessage = useCallback((message: PoseStampedMessage) => {
    if (!ros3dViewer.current || !customTFProvider.current || !visualizationGroupRef.current) {
      return;
    }

    try {
      const group = visualizationGroupRef.current;
      const provider = customTFProvider.current;
      stopTransformRef.current?.();
      stopTransformRef.current = undefined;
      group.visible = false;
      const { position, orientation } = message.pose ?? {};
      if (![position?.x, position?.y, position?.z, orientation?.x, orientation?.y, orientation?.z, orientation?.w].every(Number.isFinite)) {
        report.current?.('Pose contains invalid coordinates.');
        ros3dViewer.current.requestRender?.();
        return;
      }
      const localRotation = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
      if (!Number.isFinite(localRotation.lengthSq()) || localRotation.lengthSq() < 1e-12) {
        report.current?.('Pose orientation is invalid.');
        ros3dViewer.current.requestRender?.();
        return;
      }
      localRotation.normalize();
      let addedToTrail = false;
      stopTransformRef.current = watchMessageTransform(provider, message.header, ({ transform, error }) => {
        if (visualizationGroupRef.current !== group) return;
        const wasVisible = group.visible;
        group.visible = !!transform;
        report.current?.(error);
        if (!transform) {
          if (wasVisible) ros3dViewer.current?.requestRender?.();
          return;
        }
        const positionVec = new THREE.Vector3(position.x, position.y, position.z)
          .applyQuaternion(transform.rotation).add(transform.translation);
        const quaternion = transform.rotation.clone().multiply(localRotation);
        if (!visualizationObjectRef.current) {
          visualizationObjectRef.current = visualizationType === 'arrow'
            ? createArrow(arrowLength * scale, arrowWidth * scale, color)
            : createAxes(axesSize * scale);
          group.add(visualizationObjectRef.current);
        }
        const visualization = visualizationObjectRef.current;
        const changed = !wasVisible || !visualization.position.equals(positionVec) || !visualization.quaternion.equals(quaternion);
        visualization.position.copy(positionVec);
        visualization.quaternion.copy(quaternion);
        if (showTrail && !addedToTrail) { updateTrail(positionVec); addedToTrail = true; }
        if (changed) ros3dViewer.current?.requestRender?.();
      });
      ros3dViewer.current.requestRender?.();

    } catch (error) {
      report.current?.('Invalid PoseStamped message.');
      ros3dViewer.current?.requestRender?.();
    }
  }, [visualizationType, scale, color, arrowLength, arrowWidth, axesSize, showTrail, createArrow, createAxes, updateTrail]);

  // Setup and cleanup effect
  useEffect(() => {
    if (!isRosConnected || !ros || !ros3dViewer.current || !topic) {
      return;
    }

    console.log(`[PoseStamped] Setting up client for topic: ${topic}`);

    // Create visualization group
    if (!visualizationGroupRef.current) {
      visualizationGroupRef.current = new THREE.Group();
      visualizationGroupRef.current.visible = false;
      ros3dViewer.current.addObject(visualizationGroupRef.current);
    }

    // Create ROS topic subscriber
    const topicClient = new ROSLIB.Topic({
      ros: ros,
      name: topic,
      messageType: 'geometry_msgs/msg/PoseStamped'
    });

    let active = true;
    topicClient.subscribe(message => { if (active) handlePoseStampedMessage(message as unknown as PoseStampedMessage); });
    report.current?.('Waiting for pose messages.');
    topicClientRef.current = topicClient;

    console.log(`[PoseStamped] Subscribed to ${topic}`);

    // Cleanup function
    return () => {
      active = false;
      stopTransformRef.current?.();
      stopTransformRef.current = undefined;
      
      if (topicClientRef.current) {
        topicClientRef.current.unsubscribe();
        topicClientRef.current = null;
      }

      if (visualizationGroupRef.current && ros3dViewer.current) {
        ros3dViewer.current.scene.remove(visualizationGroupRef.current);
        if (visualizationObjectRef.current) {
          disposePoseObject(visualizationObjectRef.current);
          visualizationObjectRef.current = null;
        }
        visualizationGroupRef.current.clear();
        visualizationGroupRef.current = null;
        ros3dViewer.current.requestRender?.();
      }

      if (trailLineRef.current) {
        trailLineRef.current.geometry.dispose();
        (trailLineRef.current.material as THREE.Material).dispose();
        trailLineRef.current = null;
      }

      trailPointsRef.current = [];
    };
  }, [isRosConnected, ros, ros3dViewer, topic, fixedFrame, handlePoseStampedMessage]);

  // Update visualization when options change
  useEffect(() => {
    // Force re-render when options change by clearing the current visualization
    // The next message will recreate it with new options
    if (visualizationGroupRef.current) {
      if (visualizationObjectRef.current) {
        visualizationGroupRef.current.remove(visualizationObjectRef.current);
        disposePoseObject(visualizationObjectRef.current);
        visualizationObjectRef.current = null;
      }
      trailPointsRef.current = [];
      if (trailLineRef.current) {
        trailLineRef.current.geometry.dispose();
        (trailLineRef.current.material as THREE.Material).dispose();
        trailLineRef.current = null;
      }
      ros3dViewer.current?.requestRender?.();
    }
  }, [visualizationType, scale, color, arrowLength, arrowWidth, axesSize, showTrail, maxTrailLength]);

  return {
    isSubscribed: !!topicClientRef.current,
    visualizationGroup: visualizationGroupRef.current,
  };
}

function disposePoseObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse?.(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) mesh.material.forEach(material => materials.add(material));
    else if (mesh.material) materials.add(mesh.material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}
