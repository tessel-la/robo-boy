import * as THREE from 'three';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib'; // Keep for types used internally if any, or remove if unused

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

// --- Helper Functions for TF Logic (using THREE.js math) ---

// Invert a Transform (represented by THREE.Vector3 and THREE.Quaternion)
export function invertTransform(transform: StoredTransform): StoredTransform {
  // Use .inverse() for three.js r89 compatibility
  const invQuaternion = transform.rotation.clone().inverse();
  const invTranslation = transform.translation.clone().negate().applyQuaternion(invQuaternion); // Use THREE methods

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
  // fixedFrame: string // Removed fixedFrame, path finding doesn't need it directly
): StoredTransform | null {

  // Normalize frame IDs (remove leading slashes)
  const normalizedTargetFrame = targetFrame.startsWith('/') ? targetFrame.substring(1) : targetFrame;
  const normalizedSourceFrame = sourceFrame.startsWith('/') ? sourceFrame.substring(1) : sourceFrame;
  // const normalizedFixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame; // Keep normalization local if needed

  // console.log(`[TF Lookup] Request: ${normalizedSourceFrame} -> ${normalizedTargetFrame} (Fixed: ${normalizedFixedFrame})`);

  if (normalizedTargetFrame === normalizedSourceFrame) {
    // Identity transform using THREE types
    // console.log(`[TF Lookup] Target and source frames are identical. Returning identity.`);
    return {
      translation: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Quaternion(0, 0, 0, 1),
    };
  }

  // Find path from source to target
  // Pass transforms, source, and target. fixedFrame isn't needed for the path search itself.
  const path = findTransformPath(normalizedTargetFrame, normalizedSourceFrame, transforms);

  if (!path) {
     console.warn(`[TF Lookup] No path found from ${normalizedSourceFrame} to ${normalizedTargetFrame}. Returning null.`);
     return null;
  }

  // Chain the transforms along the path
  let finalTransform: StoredTransform = { // Start with identity using THREE types
      translation: new THREE.Vector3(),
      rotation: new THREE.Quaternion()
  };

  for (const step of path) {
      finalTransform = multiplyTransforms(finalTransform, step.transform); // Use exported helper
  }

  // console.log(`[TF Lookup] Found transform for ${normalizedSourceFrame} -> ${normalizedTargetFrame}:`, {
  //   translation: {x: finalTransform.translation.x, y: finalTransform.translation.y, z: finalTransform.translation.z },
  //   rotation: {x: finalTransform.rotation.x, y: finalTransform.rotation.y, z: finalTransform.rotation.z, w: finalTransform.rotation.w }
  // });
  return finalTransform;
}


// --- Custom TF Provider Class ---
// This class manages the TF tree using THREE types internally
// but provides an interface compatible with ros3djs (expecting ROSLIB.Transform-like structure in callback)
export class CustomTFProvider {
    // private ros: Ros; // Keep ros if needed for future extensions, otherwise remove
    private fixedFrame: string;
    private transforms: TransformStore; // Stores THREE.Vector3 and THREE.Quaternion
    private callbacks: Map<string, Set<(transform: any | null) => void>>; // Callbacks expect ROSLIB structure

    constructor(/*ros: Ros,*/ fixedFrame: string, initialTransforms: TransformStore) {
        // this.ros = ros; // Removed ROS dependency if not strictly needed by provider itself
        this.fixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame;
        this.transforms = initialTransforms;
        this.callbacks = new Map();
        // console.log(`[CustomTFProvider] Initialized with fixedFrame: ${this.fixedFrame}`);
    }

    updateTransforms(newTransforms: TransformStore) {
        const changedFrames = new Set<string>();

        // --- (Change detection logic remains the same) ---
        const oldKeys = Object.keys(this.transforms);
        const newKeys = Object.keys(newTransforms);
        if (oldKeys.length !== newKeys.length || oldKeys.some((k, i) => k !== newKeys[i])) {
             // Basic change detection - assume all subscribed frames might be affected
            this.callbacks.forEach((_, frameId) => changedFrames.add(frameId));
        } else {
             // More detailed check (optional, can be complex)
             for (const frameId of newKeys) {
                 // Compare THREE objects using their equals methods for robustness
                 const oldTf = this.transforms[frameId]?.transform;
                 const newTf = newTransforms[frameId]?.transform;
                 if (!oldTf || !newTf ||
                     !oldTf.translation.equals(newTf.translation) ||
                     !oldTf.rotation.equals(newTf.rotation))
                 {
                    // This frame or its parent changed, potentially affecting subscriptions
                    changedFrames.add(frameId);
                    // Very simplistic: Assume any change might affect any subscription for now
                    this.callbacks.forEach((_, cbFrameId) => changedFrames.add(cbFrameId));
                    break; // Optimization: if one change found, update all for now
                 }
             }
        }
        // --- (End Change detection logic) ---

        this.transforms = newTransforms;
        // console.log(`[CustomTFProvider] Transforms updated. Triggering callbacks for changed frames:`, changedFrames);

        changedFrames.forEach(frameId => {
            const frameCallbacks = this.callbacks.get(frameId);
            if (frameCallbacks) {
                const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId); // Use internal method
                // Convert to plain object matching ROSLIB structure for the callback
                const latestTransformObject = latestTransformTHREE
                  ? { // Plain object, not new ROSLIB.Transform
                      translation: { x: latestTransformTHREE.translation.x, y: latestTransformTHREE.translation.y, z: latestTransformTHREE.translation.z },
                      rotation: { x: latestTransformTHREE.rotation.x, y: latestTransformTHREE.rotation.y, z: latestTransformTHREE.rotation.z, w: latestTransformTHREE.rotation.w }
                    }
                  : null;
                // console.log(`[CustomTFProvider] Notifying ${frameCallbacks.size} callbacks for frame ${frameId} with transform:`, latestTransformObject);
                frameCallbacks.forEach(cb => {
                   try {
                     cb(latestTransformObject); // Pass the plain object
                   } catch (e) {
                     console.error(`[CustomTFProvider] Error in TF callback for frame ${frameId}:`, e);
                   }
                });
            }
        });
    }

     updateFixedFrame(newFixedFrame: string) {
        const normalizedNewFixedFrame = newFixedFrame.startsWith('/') ? newFixedFrame.substring(1) : newFixedFrame;
        if (this.fixedFrame !== normalizedNewFixedFrame) {
            // console.log(`[CustomTFProvider] Fixed frame updated from ${this.fixedFrame} to ${normalizedNewFixedFrame}`);
            this.fixedFrame = normalizedNewFixedFrame;

            // Re-evaluate transforms for all subscribed frames relative to the new fixed frame
            this.callbacks.forEach((frameCallbacks, frameId) => {
                 const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId); // Use internal method
                 const latestTransformObject = latestTransformTHREE
                   ? { // Plain object
                       translation: { x: latestTransformTHREE.translation.x, y: latestTransformTHREE.translation.y, z: latestTransformTHREE.translation.z },
                       rotation: { x: latestTransformTHREE.rotation.x, y: latestTransformTHREE.rotation.y, z: latestTransformTHREE.rotation.z, w: latestTransformTHREE.rotation.w }
                     }
                   : null;
                 // console.log(`[CustomTFProvider] Re-notifying ${frameCallbacks.size} callbacks for frame ${frameId} due to fixedFrame change.`);
                 frameCallbacks.forEach(cb => {
                   try {
                     cb(latestTransformObject); // Pass the plain object
                   } catch (e) {
                     console.error(`[CustomTFProvider] Error in TF callback for frame ${frameId} (fixedFrame update):`, e);
                   }
                 });
            });
        }
    }

    // Modify subscribe to provide plain object initially
    subscribe(frameId: string, callback: (transform: any | null) => void) { // Use 'any' for now if Transform type is problematic
        const normalizedFrameId = frameId.startsWith('/') ? frameId.substring(1) : frameId;
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
        const normalizedFrameId = frameId.startsWith('/') ? frameId.substring(1) : frameId;
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
        // IMPORTANT: For ROS3D.PointCloud2 compatibility, we need to swap sourceFrame and targetFrame
        // This is because pointcloud transformations expect the inverse direction compared to TF visualizations
        return lookupTransform(sourceFrame, targetFrame, this.transforms);
    }

    dispose() {
        console.log("[CustomTFProvider] Disposing provider.");
        this.transforms = {}; // Clear transforms
        this.callbacks.clear(); // Clear callbacks
    }
}

// Interface defining the expected structure of the TF provider object
// Useful for typing refs or props that hold the provider instance.
export interface ITFProvider extends CustomTFProvider {
  // Add any other methods/properties expected by consumers if needed
} 