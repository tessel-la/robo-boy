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
  fixedFrame: string;
  displayedTfFrames: string[]; // Array of frame names to visualize
  transforms: TransformStore;
  showAxes?: boolean;
  showFrameLabels: boolean;
  showConnections?: boolean;
  axesScale?: number; // Optional scale for the axes
  labelScale?: number; // Label height in scene metres
  axesOpacity?: number;
  labelOpacity?: number;
  showLabelBackground?: boolean;
}

// Type for the map storing visualized axes
type TfLabelEntry = {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
};

type TfAxesEntry = {
  group: THREE.Group;
  axes?: ROS3D.Axes;
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

const DEFAULT_AXES_SCALE = 0.1;
const DEFAULT_LABEL_SCALE = 0.12;
const TF_EDGE_COLOR = 0x9aa7b3;

function disposeMaterial(material: Material | Material[] | null | undefined) {
  if (Array.isArray(material)) {
    material.forEach((m: Material) => m.dispose());
  } else {
    material?.dispose();
  }
}

function disposeAxesEntry(entry: TfAxesEntry) {
  if (entry.axes?.lineSegments) {
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

function setAxesOpacity(axes: ROS3D.Axes, opacity: number) {
  const materials = axes.lineSegments?.material;
  (Array.isArray(materials) ? materials : materials ? [materials] : []).forEach(material => {
    material.transparent = opacity < 1;
    material.opacity = opacity;
  });
}

function createLabelSprite(
  frameName: string,
  axesScale: number,
  labelScale: number,
  opacity: number,
  withBackground: boolean
): TfLabelEntry | null {
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

  if (withBackground) {
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
  } else {
    // Without the pill, a dark outline keeps the name readable over light geometry.
    context.strokeStyle = 'rgba(16, 18, 20, 0.9)';
    context.lineWidth = 4;
    context.lineJoin = 'round';
    context.strokeText(frameName, horizontalPadding, height / 2);
  }

  context.fillStyle = '#f6f8fb';
  context.fillText(frameName, horizontalPadding, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  const labelHeight = Math.max(labelScale, 0.01);
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
  fixedFrame,
  displayedTfFrames,
  transforms,
  showAxes = true,
  showFrameLabels,
  showConnections = true,
  axesScale = DEFAULT_AXES_SCALE,
  labelScale = DEFAULT_LABEL_SCALE,
  axesOpacity = 1,
  labelOpacity = 1,
  showLabelBackground = true,
}: UseTfVisualizerProps) {
  const tfAxesContainerRef = useRef<THREE.Group | null>(null);
  const tfAxesMapRef = useRef<TfAxesMap>(new Map());
  const tfEdgeMapRef = useRef<TfEdgeMap>(new Map());

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

    // Cleanup function for Effect 1. Everything parented to the container goes with it: axes left
    // in the map would otherwise keep pointing at a group inside a removed (and, after a viewer
    // teardown, disposed) container, so the frames would silently vanish until the user toggled
    // them off and on again while Effect 3 kept recreating the connection lines in the new one.
    return () => {
      if ((containerAdded || !isRosConnected) && tfAxesContainerRef.current) {
        viewer?.scene.remove(tfAxesContainerRef.current);
        tfAxesMapRef.current.forEach(disposeAxesEntry);
        tfAxesMapRef.current.clear();
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
      const axes = showAxes ? new ROS3D.Axes({ lineSize: axesScale }) : null;
      if (axes) setAxesOpacity(axes, axesOpacity);
      const label = showFrameLabels
        ? createLabelSprite(frameName, axesScale, labelScale, labelOpacity, showLabelBackground)
        : null;

      if (axes) {
        group.add(axes);
      }
      if (label) {
        group.add(label.sprite);
      }
      container.add(group);
      currentMap.set(frameName, {
        group,
        ...(axes ? { axes } : {}),
        ...(label ? { label } : {}),
      });
    });
    ros3dViewer.current?.requestRender?.();

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

    // `isRosConnected` is here so the axes are rebuilt inside whichever container Effect 1 just
    // created, not only when the list or styling changes.
  }, [
    isRosConnected,
    displayedTfFrames,
    showAxes,
    axesScale,
    axesOpacity,
    showFrameLabels,
    labelScale,
    labelOpacity,
    showLabelBackground,
    ros3dViewer,
  ]);

  // Effect 3: Manage TF connection lines for selected parent-child edges
  useEffect(() => {
    const container = tfAxesContainerRef.current;
    const currentEdges = tfEdgeMapRef.current;

    if (!container) {
      return;
    }

    const selectedEdges = showConnections ? getSelectedTfFrameEdges(transforms, displayedTfFrames) : [];
    const selectedEdgeKeys = new Set(selectedEdges.map(getTfEdgeKey));
    let sceneChanged = false;

    currentEdges.forEach((entry, key) => {
      if (!selectedEdgeKeys.has(key)) {
        container.remove(entry.line);
        disposeEdgeEntry(entry);
        currentEdges.delete(key);
        sceneChanged = true;
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
      sceneChanged = true;
    });
    if (sceneChanged) {
      ros3dViewer.current?.requestRender?.();
    }
  }, [isRosConnected, displayedTfFrames, showConnections, transforms, ros3dViewer]);

  // Effect 4: Apply TF changes to axes and selected edges. TF messages already update
  // `transforms`, so polling on every animation frame only redraws unchanged scenes.
  useEffect(() => {
    const viewer = ros3dViewer.current;
    const provider = customTFProvider.current;
    const container = tfAxesContainerRef.current;
    const currentMap = tfAxesMapRef.current;
    const currentEdges = tfEdgeMapRef.current;

    if (!isRosConnected || !viewer || !provider || !container || (currentMap.size === 0 && currentEdges.size === 0)) {
      return;
    }

    const newPos = new THREE.Vector3();
    const newQuat = new THREE.Quaternion();
    const POSITION_THRESHOLD = 0.00005;
    const ROTATION_THRESHOLD = 0.00005;
    const frameTransformCache = new Map<string, StoredTransform | null>();
    let sceneChanged = false;

    const getFrameTransform = (frameName: string): StoredTransform | null => {
      if (!frameTransformCache.has(frameName)) {
        frameTransformCache.set(frameName, provider.lookupTransform(fixedFrame, frameName));
      }
      return frameTransformCache.get(frameName) ?? null;
    };

    currentMap.forEach((entry: TfAxesEntry, frameName: string) => {
      const transform = getFrameTransform(frameName);
      if (transform?.translation && transform.rotation) {
        newPos.copy(transform.translation);
        newQuat.copy(transform.rotation);
        const positionChanged = !entry.group.position.equals(newPos) &&
          entry.group.position.distanceToSquared(newPos) > POSITION_THRESHOLD;
        const rotationChanged = !entry.group.quaternion.equals(newQuat) &&
          Math.abs(entry.group.quaternion.dot(newQuat) - 1.0) > ROTATION_THRESHOLD;

        if (positionChanged || rotationChanged) {
          entry.group.position.copy(newPos);
          entry.group.quaternion.copy(newQuat);
          sceneChanged = true;
        }
        if (!entry.group.visible) {
          entry.group.visible = true;
          sceneChanged = true;
        }
      } else if (entry.group.visible) {
        entry.group.visible = false;
        sceneChanged = true;
      }
    });

    currentEdges.forEach((entry: TfEdgeEntry) => {
      const parentTransform = getFrameTransform(entry.edge.parentFrame);
      const childTransform = getFrameTransform(entry.edge.childFrame);

      if (!parentTransform?.translation || !childTransform?.translation) {
        if (entry.line.visible) {
          entry.line.visible = false;
          sceneChanged = true;
        }
        return;
      }

      const nextPositions = [
        parentTransform.translation.x,
        parentTransform.translation.y,
        parentTransform.translation.z,
        childTransform.translation.x,
        childTransform.translation.y,
        childTransform.translation.z,
      ];
      const positionsChanged = nextPositions.some((value, index) => entry.positions[index] !== value);
      if (positionsChanged || !entry.line.visible) {
        entry.positions.set(nextPositions);
        const positionAttribute = entry.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (positionAttribute) positionAttribute.needsUpdate = true;
        entry.line.visible = true;
        sceneChanged = true;
      }
    });

    if (sceneChanged) viewer.requestRender?.();
    // Effects 2 and 3 rebuild their objects at the origin whenever styling changes, so this effect
    // must run after every such rebuild, not only when a transform arrives — a static tree would
    // otherwise stay collapsed on the fixed frame until the next TF message.
  }, [
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    fixedFrame,
    displayedTfFrames,
    transforms,
    showAxes,
    axesScale,
    axesOpacity,
    showFrameLabels,
    labelScale,
    labelOpacity,
    showLabelBackground,
    showConnections,
  ]);

  // No return value needed, hook manages side effects
}
