import * as THREE from 'three';

// Interface for storing transforms using THREE types within ROSLIB container
export interface TransformStore {
  [childFrame: string]: {
    parentFrame: string;
    // Store ROSLIB.Transform but ensure its properties are THREE types
    transform: {
      translation: THREE.Vector3;
      rotation: THREE.Quaternion;
    };
    isStatic: boolean;
  };
}

// Type alias for the structure stored in the TransformStore
export type StoredTransform = {
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
};

export interface TfFrameEdge {
  parentFrame: string;
  childFrame: string;
}

function transformsEqual(
  left: TransformStore[string] | undefined,
  right: TransformStore[string] | undefined,
): boolean {
  return left === right || Boolean(
    left &&
    right &&
    left.parentFrame === right.parentFrame &&
    left.isStatic === right.isStatic &&
    left.transform.translation.equals(right.transform.translation) &&
    left.transform.rotation.equals(right.transform.rotation)
  );
}

function getChangedFrames(previous: TransformStore, next: TransformStore): Set<string> {
  const changedFrames = new Set<string>();
  const frameIds = new Set([...Object.keys(previous), ...Object.keys(next)]);

  frameIds.forEach(frameId => {
    if (!transformsEqual(previous[frameId], next[frameId])) changedFrames.add(frameId);
  });

  return changedFrames;
}

function chainContainsChangedFrame(
  startFrame: string,
  transforms: TransformStore,
  changedFrames: ReadonlySet<string>,
): boolean {
  let currentFrame = normalizeFrameId(startFrame);
  const visited = new Set<string>();

  while (currentFrame && !visited.has(currentFrame)) {
    if (changedFrames.has(currentFrame)) return true;
    visited.add(currentFrame);
    currentFrame = transforms[currentFrame]?.parentFrame || '';
  }

  return false;
}

// Reusable identity transform to avoid creating new objects
export const IDENTITY_TRANSFORM: StoredTransform = {
  translation: new THREE.Vector3(0, 0, 0),
  rotation: new THREE.Quaternion(0, 0, 0, 1), // Identity quaternion
};

// --- Helper Functions for TF Logic (using THREE.js math) ---

export function normalizeFrameId(frameId: string): string {
  return frameId.startsWith('/') ? frameId.substring(1) : frameId;
}

/** Every frame id the store knows about (parents included), normalized and sorted. */
export function getTfFrameNames(transforms: TransformStore): string[] {
  const frames = new Set<string>();
  Object.entries(transforms).forEach(([childFrame, entry]) => {
    frames.add(normalizeFrameId(childFrame));
    frames.add(normalizeFrameId(entry.parentFrame));
  });
  return [...frames].filter(Boolean).sort();
}

/** Frames that are only ever parents: the roots of the TF forest. */
export function getTfRootFrames(transforms: TransformStore): string[] {
  const children = new Set(Object.keys(transforms).map(normalizeFrameId));
  return getTfFrameNames(transforms).filter(frame => !children.has(frame));
}

const PREFERRED_FIXED_FRAMES = ['world', 'map', 'odom'];
export const FALLBACK_FIXED_FRAME = 'map';

/**
 * Picks the frame the 3D view should be anchored to. A frame the user chose wins while it exists
 * in the tree (or before any TF has arrived); otherwise the first of `world`, `map`, `odom` that
 * is present, then a tree root, then the alphabetically first frame. `preferredFrame` of '' means
 * "auto", so nothing is hardcoded for robots that publish none of the conventional names.
 */
export function resolveFixedFrame(preferredFrame: string, transforms: TransformStore): string {
  const preferred = normalizeFrameId(preferredFrame);
  const frames = getTfFrameNames(transforms);
  if (frames.length === 0) return preferred || FALLBACK_FIXED_FRAME;
  if (preferred && frames.includes(preferred)) return preferred;

  const conventional = PREFERRED_FIXED_FRAMES.find(frame => frames.includes(frame));
  if (conventional) return conventional;

  return getTfRootFrames(transforms)[0] ?? frames[0];
}

export function getSelectedTfFrameEdges(
  transforms: TransformStore,
  selectedFrames: string[],
): TfFrameEdge[] {
  const selectedFrameSet = new Set(selectedFrames.map(normalizeFrameId));
  const edgeKeys = new Set<string>();
  const edges: TfFrameEdge[] = [];

  Object.entries(transforms).forEach(([childFrameKey, data]) => {
    const childFrame = normalizeFrameId(childFrameKey);
    const parentFrame = normalizeFrameId(data.parentFrame);

    if (!selectedFrameSet.has(parentFrame) || !selectedFrameSet.has(childFrame)) {
      return;
    }

    const edgeKey = `${parentFrame}->${childFrame}`;
    if (edgeKeys.has(edgeKey)) {
      return;
    }

    edgeKeys.add(edgeKey);
    edges.push({ parentFrame, childFrame });
  });

  return edges;
}

// Invert a Transform (represented by THREE.Vector3 and THREE.Quaternion)
export function invertTransform(transform: StoredTransform): StoredTransform {
  // Use quaternion inversion - THREE.js uses .invert() method
  const invQuaternion = transform.rotation.clone().invert();

  // Safely calculate inverted translation using the inverted quaternion
  const invTranslation = transform.translation.clone().negate();
  invTranslation.applyQuaternion(invQuaternion);

  return {
    translation: invTranslation,
    rotation: invQuaternion
  };
}


// Multiply two Transforms (transform1 * transform2) -> apply transform2 then transform1
export function multiplyTransforms(transform1: StoredTransform, transform2: StoredTransform): StoredTransform {
  const finalRotation = transform1.rotation.clone().multiply(transform2.rotation);
  const finalTranslation = transform1.translation.clone().add(transform2.translation.clone().applyQuaternion(transform1.rotation));

  return {
    translation: finalTranslation,
    rotation: finalRotation
  };
}


// Function to find the path between frames
export function findTransformPath(
  targetFrame: string,
  sourceFrame: string,
  transforms: TransformStore,
  // fixedFrame: string // Removed fixedFrame as it's not used in path finding itself
): { frame: string; transform: StoredTransform; isStatic: boolean }[] | null {
  if (targetFrame === sourceFrame) {
    return []; // No transform needed
  }

  const queue: { frame: string; path: { frame: string; transform: StoredTransform; isStatic: boolean }[] }[] = [{ frame: sourceFrame, path: [] }];
  const visited = new Set<string>([sourceFrame]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue; // Should not happen with TS

    const currentFrame = current.frame;

    // Check direct children
    for (const childFrame in transforms) {
      const data = transforms[childFrame];
      if (data.parentFrame === currentFrame && !visited.has(childFrame)) {
        const newPath = [...current.path, { frame: childFrame, transform: data.transform, isStatic: data.isStatic }];
        if (childFrame === targetFrame) return newPath;
        visited.add(childFrame);
        queue.push({ frame: childFrame, path: newPath });
      }
    }

    // Check parent (using inverse transform)
    const parentData = transforms[currentFrame];
    if (parentData && !visited.has(parentData.parentFrame)) {
      const invTransform = invertTransform(parentData.transform); // Use exported helper
      const newPath = [...current.path, { frame: parentData.parentFrame, transform: invTransform, isStatic: parentData.isStatic }];
      if (parentData.parentFrame === targetFrame) return newPath;
      visited.add(parentData.parentFrame);
      queue.push({ frame: parentData.parentFrame, path: newPath });
    }
  }

  console.warn(`[TF Logic] No path found from ${sourceFrame} to ${targetFrame} in TF tree.`);
  return null; // No path found
}

// Main lookup function - returns the final THREE transform components
export function lookupTransform(
  targetFrame: string,
  sourceFrame: string,
  transforms: TransformStore,
): StoredTransform | null {

  // Normalize frame IDs (remove leading slashes)
  const normalizedTargetFrame = normalizeFrameId(targetFrame);
  const normalizedSourceFrame = normalizeFrameId(sourceFrame);

  // For debugging
  const startTime = performance.now();

  try {
    if (normalizedTargetFrame === normalizedSourceFrame) {
      // Return a shared identity transform to avoid memory allocation
      return IDENTITY_TRANSFORM;
    }

    // First check direct parent-child relationship for fast path
    if (transforms[normalizedSourceFrame]?.parentFrame === normalizedTargetFrame) {
      // Direct inverse transform
      try {
        return invertTransform(transforms[normalizedSourceFrame].transform);
      } catch (err) {
        console.error(`[TF] Error inverting direct transform from ${normalizedSourceFrame} to ${normalizedTargetFrame}:`, err);
        // Fall back to slower path search
      }
    } else if (transforms[normalizedTargetFrame]?.parentFrame === normalizedSourceFrame) {
      // Direct transform
      return transforms[normalizedTargetFrame].transform;
    }

    // Find path from source to target
    const path = findTransformPath(normalizedTargetFrame, normalizedSourceFrame, transforms);

    if (!path) {
      // For debugging only - log frames that might be available
      if (normalizedSourceFrame.includes('lidar') || normalizedTargetFrame.includes('lidar')) {
        const availableFrames = Object.keys(transforms);
        console.debug(`[TF] No path found from ${normalizedSourceFrame} to ${normalizedTargetFrame}. Available frames: ` +
          availableFrames.filter(f => f.includes('lidar') || transforms[f].parentFrame.includes('lidar')).join(', '));
      }
      return null;
    }

    // Chain the transforms along the path
    let finalTransform: StoredTransform;

    if (path.length === 0) {
      return IDENTITY_TRANSFORM;
    } else if (path.length === 1) {
      return path[0].transform;
    } else {
      try {
        finalTransform = path[0].transform;
        for (let i = 1; i < path.length; i++) {
          finalTransform = multiplyTransforms(finalTransform, path[i].transform);
        }
        return finalTransform;
      } catch (err) {
        console.error(`[TF] Error chaining transforms from ${normalizedSourceFrame} to ${normalizedTargetFrame}:`, err);
        return null;
      }
    }
  } catch (err) {
    console.error(`[TF] Unexpected error in lookupTransform from ${normalizedSourceFrame} to ${normalizedTargetFrame}:`, err);
    return null;
  } finally {
    // Performance logging for slow transforms (> 10ms)
    const endTime = performance.now();
    const duration = endTime - startTime;
    if (duration > 10) {
      console.warn(`[TF] Slow transform lookup from ${normalizedSourceFrame} to ${normalizedTargetFrame}: ${duration.toFixed(2)}ms`);
    }
  }
}


// --- Custom TF Provider Class ---
// This class manages the TF tree using THREE types internally
// but provides an interface compatible with ros3djs (expecting ROSLIB.Transform-like structure in callback)
export class CustomTFProvider {
  // Public fixedFrame for external access
  public fixedFrame: string;
  private transforms: TransformStore; // Stores THREE.Vector3 and THREE.Quaternion
  private callbacks: Map<string, Set<(transform: any | null) => void>>; // Callbacks expect ROSLIB structure
  private disposed = false;

  constructor(/*ros: Ros,*/ fixedFrame: string, initialTransforms: TransformStore) {
    // this.ros = ros; // Removed ROS dependency if not strictly needed by provider itself
    this.fixedFrame = normalizeFrameId(fixedFrame);
    this.transforms = initialTransforms;
    this.callbacks = new Map();
    console.log(`[CustomTFProvider] Initialized with fixedFrame: ${this.fixedFrame}`);
  }

  updateTransforms(newTransforms: TransformStore, knownChangedFrames?: ReadonlySet<string>) {
    if (this.disposed) return;

    const oldTransforms = this.transforms;
    const changedFrames = knownChangedFrames ?? getChangedFrames(oldTransforms, newTransforms);

    this.transforms = newTransforms;

    if (changedFrames.size > 0 && this.callbacks.size > 0) {
      const fixedFrameChanged =
        chainContainsChangedFrame(this.fixedFrame, oldTransforms, changedFrames) ||
        chainContainsChangedFrame(this.fixedFrame, newTransforms, changedFrames);

      this.callbacks.forEach((frameCallbacks, frameId) => {
        const subscribedPathChanged = fixedFrameChanged ||
          chainContainsChangedFrame(frameId, oldTransforms, changedFrames) ||
          chainContainsChangedFrame(frameId, newTransforms, changedFrames);

        if (subscribedPathChanged) {
          const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId);
          const latestTransformObject = latestTransformTHREE
            ? {
              translation: { x: latestTransformTHREE.translation.x, y: latestTransformTHREE.translation.y, z: latestTransformTHREE.translation.z },
              rotation: { x: latestTransformTHREE.rotation.x, y: latestTransformTHREE.rotation.y, z: latestTransformTHREE.rotation.z, w: latestTransformTHREE.rotation.w }
            }
            : null;

          frameCallbacks.forEach(cb => {
            try {
              cb(latestTransformObject);
            } catch (e) {
              console.error(`[CustomTFProvider] Error in TF callback for frame ${frameId}:`, e);
            }
          });
        }
      });
    }
  }

  updateFixedFrame(newFixedFrame: string) {
    if (this.disposed) return;
    // Normalize frame ID (remove leading slash)
    const normalizedNewFrame = normalizeFrameId(newFixedFrame);

    // Only update if actually changed
    if (this.fixedFrame === normalizedNewFrame) {
      console.log(`[TFProvider] Fixed frame is already ${normalizedNewFrame}, no change needed`);
      return;
    }

    console.log(`[TFProvider] Updating fixed frame from ${this.fixedFrame} to ${normalizedNewFrame}`);

    // Update the frame first
    this.fixedFrame = normalizedNewFrame;

    // Now update all callbacks - this must happen after the frame is updated
    // so lookupTransform uses the new fixed frame
    let updatedCount = 0;
    let errorCount = 0;

    this.callbacks.forEach((callbackSet, frameId) => {
      callbackSet.forEach(callback => {
        try {
          // Recalculate transform with new fixed frame
          const transform = this.lookupTransform(this.fixedFrame, frameId);
          if (transform) {
            // Convert to proper format and trigger callback
            const transformObject = this.transformToROSLIB(transform);
            callback(transformObject);
            updatedCount++;
          } else {
            console.warn(`[TFProvider] No transform found for ${frameId} after fixed frame change to ${this.fixedFrame}`);
            callback(null); // Frame is now unavailable
            errorCount++;
          }
        } catch (error) {
          console.warn(`[TFProvider] Error updating callback for ${frameId} after fixed frame change:`, error);
          callback(null); // Frame is now unavailable
          errorCount++;
        }
      });
    });

    console.log(`[TFProvider] Updated ${updatedCount} transform subscribers after fixed frame change (${errorCount} errors)`);
  }

  // Modify subscribe to provide plain object initially
  subscribe(frameId: string, callback: (transform: any | null) => void) { // Use 'any' for now if Transform type is problematic
    if (this.disposed) return;
    const normalizedFrameId = normalizeFrameId(frameId);
    // console.log(`[CustomTFProvider] subscribe called for frameId: ${normalizedFrameId}`);

    if (!this.callbacks.has(normalizedFrameId)) {
      this.callbacks.set(normalizedFrameId, new Set());
    }
    const frameCallbacks = this.callbacks.get(normalizedFrameId)!;
    frameCallbacks.add(callback);
    // console.log(`[CustomTFProvider] Added callback for ${normalizedFrameId}. Total callbacks: ${frameCallbacks.size}`);

    // Immediately provide the current transform as a plain object
    const currentTransformTHREE = this.lookupTransform(this.fixedFrame, normalizedFrameId); // Use internal method
    const currentTransformObject = currentTransformTHREE
      ? { // Plain object
        translation: { x: currentTransformTHREE.translation.x, y: currentTransformTHREE.translation.y, z: currentTransformTHREE.translation.z },
        rotation: { x: currentTransformTHREE.rotation.x, y: currentTransformTHREE.rotation.y, z: currentTransformTHREE.rotation.z, w: currentTransformTHREE.rotation.w }
      }
      : null;
    // console.log(`[CustomTFProvider] Providing initial transform for ${normalizedFrameId}:`, currentTransformObject);
    try {
      callback(currentTransformObject); // Pass the plain object
    } catch (e) {
      console.error(`[CustomTFProvider] Error in initial TF callback for frame ${normalizedFrameId}:`, e);
    }
  }

  // Modify unsubscribe type signature
  unsubscribe(frameId: string, callback?: (transform: any | null) => void) { // Use 'any' for now
    if (this.disposed) return;
    const normalizedFrameId = normalizeFrameId(frameId);
    // console.log(`[CustomTFProvider] unsubscribe called for frameId: ${normalizedFrameId}`);
    const frameCallbacks = this.callbacks.get(normalizedFrameId);
    if (frameCallbacks) {
      if (callback) {
        frameCallbacks.delete(callback);
        // console.log(`[CustomTFProvider] Removed specific callback for ${normalizedFrameId}. Remaining: ${frameCallbacks.size}`);
      } else {
        frameCallbacks.clear();
        // console.log(`[CustomTFProvider] Cleared all callbacks for ${normalizedFrameId}.`);
      }
      if (frameCallbacks.size === 0) {
        this.callbacks.delete(normalizedFrameId);
        // console.log(`[CustomTFProvider] No more callbacks for ${normalizedFrameId}, removed entry.`);
      }
    } else {
      // console.log(`[CustomTFProvider] No callbacks found for ${normalizedFrameId} to unsubscribe.`);
    }
  }

  // Ensure this public method uses the external helper
  public lookupTransform(targetFrame: string, sourceFrame: string): StoredTransform | null {
    if (this.disposed) return null;
    // Normalize frames for consistency
    const normalizedTargetFrame = normalizeFrameId(targetFrame);
    const normalizedSourceFrame = normalizeFrameId(sourceFrame);

    // IMPORTANT: For ROS3D.PointCloud2 compatibility, we need to swap sourceFrame and targetFrame
    // This is because pointcloud transformations expect the inverse direction compared to TF visualizations
    const result = lookupTransform(normalizedSourceFrame, normalizedTargetFrame, this.transforms);

    if (!result) {
      // Log detailed debug info when transform lookup fails
      const availableFrames = Object.keys(this.transforms).join(', ');
      const sourceParent = this.transforms[normalizedSourceFrame]?.parentFrame;
      const targetParent = this.transforms[normalizedTargetFrame]?.parentFrame;

      console.debug(`[TFProvider] Could not find transform from ${normalizedSourceFrame} to ${normalizedTargetFrame}. ` +
        `Source parent: ${sourceParent || 'none'}, Target parent: ${targetParent || 'none'}. ` +
        `Available frames: ${availableFrames}`);
    }

    return result;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    console.log("[CustomTFProvider] Disposing provider.");
    this.transforms = {}; // Clear transforms
    this.callbacks.clear(); // Clear callbacks
  }

  // Helper method to convert THREE.js transform to ROSLIB format for callbacks
  private transformToROSLIB(transform: StoredTransform | null): any {
    if (!transform) return null;

    return {
      translation: {
        x: transform.translation.x,
        y: transform.translation.y,
        z: transform.translation.z
      },
      rotation: {
        x: transform.rotation.x,
        y: transform.rotation.y,
        z: transform.rotation.z,
        w: transform.rotation.w
      }
    };
  }
}

// Interface defining the expected structure of the TF provider object
// Useful for typing refs or props that hold the provider instance.
export interface ITFProvider extends CustomTFProvider {
  // Add any other methods/properties expected by consumers if needed
}
