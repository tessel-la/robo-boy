import { useEffect, useRef } from 'react';
import * as ROS3D from '../utils/ros3d';
import * as THREE from 'three';
import { Material } from 'three';
import {
  CustomTFProvider,
  getSelectedTfFrameEdges,
  TransformStore,
  TfFrameEdge,
  StoredTransform,
} from '../utils/tfUtils'; // Import the provider class

interface UseTfVisualizerProps {
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  customTFProvider: React.RefObject<CustomTFProvider | null>;
  displayedTfFrames: string[]; // Array of frame names to visualize
  transforms: TransformStore;
  showFrameLabels: boolean;
  axesScale?: number; // Optional scale for the axes
}

// Type for the map storing visualized axes
type TfLabelEntry = {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
};

type TfAxesEntry = {
  group: THREE.Group;
  axes: ROS3D.Axes;
  label?: TfLabelEntry;
};

type TfAxesMap = Map<string, TfAxesEntry>;
type TfEdgeEntry = {
  edge: TfFrameEdge;
  line: THREE.Line;
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  positions: Float32Array;
};
type TfEdgeMap = Map<string, TfEdgeEntry>;

const DEFAULT_AXES_SCALE = 0.5;
const TF_EDGE_COLOR = 0x9aa7b3;

function disposeMaterial(material: Material | Material[] | null | undefined) {
  if (Array.isArray(material)) {
    material.forEach((m: Material) => m.dispose());
  } else {
    material?.dispose();
  }
}

function disposeAxesEntry(entry: TfAxesEntry) {
  if (entry.axes.lineSegments) {
    entry.axes.lineSegments.geometry?.dispose();
    disposeMaterial(entry.axes.lineSegments.material);
  }

  if (entry.label) {
    entry.label.texture.dispose();
    entry.label.material.dispose();
  }
}

function disposeEdgeEntry(entry: TfEdgeEntry) {
  entry.geometry.dispose();
  entry.material.dispose();
}

function getTfEdgeKey(edge: TfFrameEdge): string {
  return `${edge.parentFrame}->${edge.childFrame}`;
}

function createLabelSprite(frameName: string, axesScale: number): TfLabelEntry | null {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const fontSize = 28;
  const horizontalPadding = 14;
  const verticalPadding = 8;

  context.font = `600 ${fontSize}px sans-serif`;
  const textWidth = Math.ceil(context.measureText(frameName).width);
  const width = textWidth + horizontalPadding * 2;
  const height = fontSize + verticalPadding * 2;

  canvas.width = Math.ceil(width * pixelRatio);
  canvas.height = Math.ceil(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  context.scale(pixelRatio, pixelRatio);
  context.font = `600 ${fontSize}px sans-serif`;
  context.textBaseline = 'middle';

  const radius = 6;
  context.fillStyle = 'rgba(16, 18, 20, 0.82)';
  context.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(width - radius, 0);
  context.quadraticCurveTo(width, 0, width, radius);
  context.lineTo(width, height - radius);
  context.quadraticCurveTo(width, height, width - radius, height);
  context.lineTo(radius, height);
  context.quadraticCurveTo(0, height, 0, height - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = '#f6f8fb';
  context.fillText(frameName, horizontalPadding, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const labelHeight = Math.max(axesScale * 0.22, 0.12);
  const labelWidth = labelHeight * (width / height);

  sprite.scale.set(labelWidth, labelHeight, 1);
  sprite.position.set(axesScale * 0.6, axesScale * 0.6, axesScale * 0.25);
  sprite.renderOrder = 10;

  return { sprite, texture, material };
}

function createEdgeEntry(edge: TfFrameEdge): TfEdgeEntry {
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: TF_EDGE_COLOR,
    transparent: true,
    opacity: 0.62,
    depthTest: false,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 2;
  line.visible = false;

  return { edge, line, geometry, material, positions };
}

export function useTfVisualizer({
  isRosConnected,
  ros3dViewer,
  customTFProvider,
  displayedTfFrames,
  transforms,
  showFrameLabels,
  axesScale = DEFAULT_AXES_SCALE,
}: UseTfVisualizerProps) {
  const tfAxesContainerRef = useRef<THREE.Group | null>(null);
  const tfAxesMapRef = useRef<TfAxesMap>(new Map());
  const tfEdgeMapRef = useRef<TfEdgeMap>(new Map());
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
        tfEdgeMapRef.current.forEach(disposeEdgeEntry);
        tfEdgeMapRef.current.clear();
        tfAxesContainerRef.current = null;
      } else if (!isRosConnected && tfAxesContainerRef.current) {
        // If ROS disconnected, ensure container is removed if it exists
        // console.log('[useTfVisualizer] ROS disconnected, removing TF Axes container');
        viewer?.scene.remove(tfAxesContainerRef.current);
        tfEdgeMapRef.current.forEach(disposeEdgeEntry);
        tfEdgeMapRef.current.clear();
        tfAxesContainerRef.current = null;
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
    currentMap.forEach((_: TfAxesEntry, frameName: string) => {
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
        disposeAxesEntry(entry);
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
      const label = showFrameLabels ? createLabelSprite(frameName, axesScale) : null;

      group.add(axes);
      if (label) {
        group.add(label.sprite);
      }
      container.add(group);
      currentMap.set(frameName, {
        group,
        axes,
        ...(label ? { label } : {}),
      });
    });

    // Cleanup function for Effect 2
    return () => {
      // console.log('[useTfVisualizer] Cleanup Effect 2: Individual Axes');
      // When dependencies change (e.g., displayedTfFrames) or component unmounts,
      // clean up *all* axes managed by this hook instance.
      const mapToClear = tfAxesMapRef.current; // Use the ref's current value at cleanup time
      const containerAtCleanup = tfAxesContainerRef.current;

      mapToClear.forEach((entry: TfAxesEntry, _frameName: string) => {
        // console.log(`[useTfVisualizer Cleanup] Removing/Disposing Axes for ${frameName}`);
        containerAtCleanup?.remove(entry.group);
        disposeAxesEntry(entry);
      });
      mapToClear.clear(); // Clear the map itself
    };

  }, [displayedTfFrames, axesScale, showFrameLabels]); // Re-run when the list, scale, or label mode changes

  // Effect 3: Manage TF connection lines for selected parent-child edges
  useEffect(() => {
    const container = tfAxesContainerRef.current;
    const currentEdges = tfEdgeMapRef.current;

    if (!container) {
      return;
    }

    const selectedEdges = getSelectedTfFrameEdges(transforms, displayedTfFrames);
    const selectedEdgeKeys = new Set(selectedEdges.map(getTfEdgeKey));

    currentEdges.forEach((entry, key) => {
      if (!selectedEdgeKeys.has(key)) {
        container.remove(entry.line);
        disposeEdgeEntry(entry);
        currentEdges.delete(key);
      }
    });

    selectedEdges.forEach((edge) => {
      const key = getTfEdgeKey(edge);
      if (currentEdges.has(key)) {
        return;
      }

      const edgeEntry = createEdgeEntry(edge);
      container.add(edgeEntry.line);
      currentEdges.set(key, edgeEntry);
    });
  }, [displayedTfFrames, transforms]);

  // Effect 4: Animation loop to update axes poses and selected TF edges
  useEffect(() => {
    // Set refresh rate to 30 fps (33ms between frames)
    const VISUALIZATION_REFRESH_RATE_MS = 33; // 30 fps
    let lastUpdateTime = 0;

    // Reuse these objects to avoid garbage collection
    const newPos = new THREE.Vector3();
    const newQuat = new THREE.Quaternion();

    const updateAxesPoses = (timestamp: number) => {
      const viewer = ros3dViewer.current;
      const provider = customTFProvider.current;
      const container = tfAxesContainerRef.current;
      const currentMap = tfAxesMapRef.current;
      const currentEdges = tfEdgeMapRef.current;

      // Ensure everything needed is available
      if (!isRosConnected || !viewer || !provider || !container || (currentMap.size === 0 && currentEdges.size === 0)) {
        animationFrameId.current = requestAnimationFrame(updateAxesPoses);
        return;
      }

      // Throttle updates to target 30 fps
      if (timestamp - lastUpdateTime < VISUALIZATION_REFRESH_RATE_MS) {
        animationFrameId.current = requestAnimationFrame(updateAxesPoses);
        return;
      }

      lastUpdateTime = timestamp;
      const fixedFrame = viewer.fixedFrame || 'odom';

      // Use smaller thresholds for faster response but still avoid tiny changes
      const POSITION_THRESHOLD = 0.00005;
      const ROTATION_THRESHOLD = 0.00005;
      const frameTransformCache = new Map<string, StoredTransform | null>();

      const getFrameTransform = (frameName: string): StoredTransform | null => {
        if (!frameTransformCache.has(frameName)) {
          frameTransformCache.set(frameName, provider.lookupTransform(fixedFrame, frameName));
        }

        return frameTransformCache.get(frameName) ?? null;
      };

      currentMap.forEach((entry: TfAxesEntry, frameName: string) => {
        const transform = getFrameTransform(frameName);
        if (transform && transform.translation && transform.rotation) {
          // Reuse objects to avoid garbage collection
          newPos.set(
            transform.translation.x,
            transform.translation.y,
            transform.translation.z
          );
          newQuat.set(
            transform.rotation.x,
            transform.rotation.y,
            transform.rotation.z,
            transform.rotation.w
          );

          // Only update if the change is significant
          const positionChanged = !entry.group.position.equals(newPos) &&
            entry.group.position.distanceToSquared(newPos) > POSITION_THRESHOLD;

          const rotationChanged = !entry.group.quaternion.equals(newQuat) &&
            Math.abs(entry.group.quaternion.dot(newQuat) - 1.0) > ROTATION_THRESHOLD;

          if (positionChanged || rotationChanged) {
            entry.group.position.copy(newPos);
            entry.group.quaternion.copy(newQuat);
          }

          if (!entry.group.visible) {
            entry.group.visible = true;
          }
        } else if (entry.group.visible) {
          entry.group.visible = false;
        }
      });

      currentEdges.forEach((entry: TfEdgeEntry) => {
        const parentTransform = getFrameTransform(entry.edge.parentFrame);
        const childTransform = getFrameTransform(entry.edge.childFrame);

        if (!parentTransform?.translation || !childTransform?.translation) {
          entry.line.visible = false;
          return;
        }

        entry.positions[0] = parentTransform.translation.x;
        entry.positions[1] = parentTransform.translation.y;
        entry.positions[2] = parentTransform.translation.z;
        entry.positions[3] = childTransform.translation.x;
        entry.positions[4] = childTransform.translation.y;
        entry.positions[5] = childTransform.translation.z;

        const positionAttribute = entry.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (positionAttribute) {
          positionAttribute.needsUpdate = true;
        }
        entry.line.visible = true;
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
      // console.log('[useTfVisualizer] Cleanup Effect 4: Cancelling animation frame');
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isRosConnected, ros3dViewer, customTFProvider]); // Re-run if connection, viewer, or provider changes

  // No return value needed, hook manages side effects
}
