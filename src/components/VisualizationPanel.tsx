import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
// Revert to using namespace for roslib types
import { Ros } from 'roslib'; 
import * as ROSLIB from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three'; // Keep THREE import for potential use, though ROS3D handles Points creation
import './VisualizationPanel.css';

// Interface for storing transforms using THREE types within ROSLIB container
interface TransformStore {
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
 type StoredTransform = { 
    translation: THREE.Vector3; 
    rotation: THREE.Quaternion; 
 };

// --- Helper Functions for TF Logic (using THREE.js math) ---

// Invert a Transform (represented by THREE.Vector3 and THREE.Quaternion)
function invertTransform(transform: StoredTransform): StoredTransform {
  // Use .inverse() for three.js r89 compatibility
  const invQuaternion = transform.rotation.clone().inverse(); 
  const invTranslation = transform.translation.clone().negate().applyQuaternion(invQuaternion); // Use THREE methods

  return {
    translation: invTranslation,
    rotation: invQuaternion
  };
}


// Multiply two Transforms (transform1 * transform2) -> apply transform2 then transform1
function multiplyTransforms(transform1: StoredTransform, transform2: StoredTransform): StoredTransform {
  const finalRotation = transform1.rotation.clone().multiply(transform2.rotation);
  const finalTranslation = transform1.translation.clone().add(transform2.translation.clone().applyQuaternion(transform1.rotation));

  return {
    translation: finalTranslation,
    rotation: finalRotation
  };
}


// Function to find the path between frames
function findTransformPath(
  targetFrame: string,
  sourceFrame: string,
  transforms: TransformStore,
  fixedFrame: string
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
       const invTransform = invertTransform(parentData.transform);
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
function lookupTransform(
  targetFrame: string,
  sourceFrame: string,
  transforms: TransformStore,
  fixedFrame: string // fixedFrame might be implicitly the root in simple cases
): StoredTransform | null {

  // Normalize frame IDs (remove leading slashes)
  const normalizedTargetFrame = targetFrame.startsWith('/') ? targetFrame.substring(1) : targetFrame;
  const normalizedSourceFrame = sourceFrame.startsWith('/') ? sourceFrame.substring(1) : sourceFrame;
  const normalizedFixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame;

  console.log(`[TF Lookup] Request: ${normalizedSourceFrame} -> ${normalizedTargetFrame} (Fixed: ${normalizedFixedFrame})`);

  if (normalizedTargetFrame === normalizedSourceFrame) {
    // Identity transform using THREE types
    console.log(`[TF Lookup] Target and source frames are identical. Returning identity.`);
    return {
      translation: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Quaternion(0, 0, 0, 1),
    };
  }

  // Find path from source to target
  const path = findTransformPath(normalizedTargetFrame, normalizedSourceFrame, transforms, normalizedFixedFrame);

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
      finalTransform = multiplyTransforms(finalTransform, step.transform); // Correct order: apply step.transform *then* finalTransform
      // Original was: multiplyTransforms(step.transform, finalTransform) which meant final = step * final
      // We want final = final * step (apply existing, then apply next step relative to it)
  }

  console.log(`[TF Lookup] Found transform for ${normalizedSourceFrame} -> ${normalizedTargetFrame}:`, {
    translation: {x: finalTransform.translation.x, y: finalTransform.translation.y, z: finalTransform.translation.z },
    rotation: {x: finalTransform.rotation.x, y: finalTransform.rotation.y, z: finalTransform.rotation.z, w: finalTransform.rotation.w }
  });
  return finalTransform;
}


// --- Custom TF Provider Class ---
// This class manages the TF tree using THREE types internally
// but provides an interface compatible with ros3djs (expecting ROSLIB.Transform-like structure in callback)
class CustomTFProvider {
    private ros: Ros;
    private fixedFrame: string;
    private transforms: TransformStore; // Stores THREE.Vector3 and THREE.Quaternion
    private callbacks: Map<string, Set<(transform: any | null) => void>>; // Callbacks expect ROSLIB structure

    constructor(ros: Ros, fixedFrame: string, initialTransforms: TransformStore) {
        this.ros = ros;
        this.fixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame;;
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
                const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId);
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

            this.callbacks.forEach((frameCallbacks, frameId) => {
                 const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId);
                 const latestTransformObject = latestTransformTHREE
                   ? { // Plain object, not new ROSLIB.Transform
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
        const currentTransformTHREE = this.lookupTransform(this.fixedFrame, normalizedFrameId);
        const currentTransformObject = currentTransformTHREE
            ? { // Plain object, not new ROSLIB.Transform
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

    // Internal lookup uses THREE types
    lookupTransform(targetFrame: string, sourceFrame: string): StoredTransform | null {
       return lookupTransform(targetFrame, sourceFrame, this.transforms, this.fixedFrame);
    }

    dispose() {
        // console.log("[CustomTFProvider] Disposing...");
        this.callbacks.clear();
    }
}


interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
}

const DEFAULT_FIXED_FRAME = 'odom'; // Or your preferred default, e.g., 'map', 'base_link'

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({ ros }: VisualizationPanelProps) => {
  // console.log(`--- VisualizationPanel Render Start ---`);

  const viewerRef = useRef<HTMLDivElement>(null);
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null);
  const customTFProvider = useRef<CustomTFProvider | null>(null); // ADDED
  const tfSub = useRef<ROSLIB.Topic | null>(null); // Use namespace
  const tfStaticSub = useRef<ROSLIB.Topic | null>(null); // Use namespace

  // Store transforms in state (using THREE types internally)
  const [transforms, setTransforms] = useState<TransformStore>({}); // ADDED

  const pointsClient = useRef<ROS3D.PointCloud2 | null>(null);
  const orbitControlsRef = useRef<any | null>(null);

  const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>('');
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);
  const [isTopicMenuOpen, setIsTopicMenuOpen] = useState(false);
  const topicMenuRef = useRef<HTMLDivElement>(null);
  const [fixedFrame, setFixedFrame] = useState<string>(DEFAULT_FIXED_FRAME);
  const [availableFrames, setAvailableFrames] = useState<string[]>([DEFAULT_FIXED_FRAME]); // NEW state for frames
  
  // State for UI controls
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false); // NEW state for popup
  const settingsPopupRef = useRef<HTMLDivElement>(null); // NEW ref for popup

  // --- Callback for handling TF messages (populates store & extracts frames) ---
  const handleTFMessage = useCallback((message: any /* tf2_msgs/TFMessage */, isStatic: boolean) => {
    const currentFrames = new Set<string>(availableFrames); // Use Set for efficient unique add
    let newFramesFound = false;

    // Fix implicit any
    setTransforms((prevTransforms: TransformStore) => {
      const newTransforms = { ...prevTransforms };
      let changed = false;
      message.transforms.forEach((tStamped: any /* geometry_msgs/TransformStamped */) => {
        const parentFrame = (tStamped.header.frame_id || '').startsWith('/')
             ? tStamped.header.frame_id.substring(1)
             : (tStamped.header.frame_id || '');
         const childFrame = (tStamped.child_frame_id || '').startsWith('/')
             ? tStamped.child_frame_id.substring(1)
             : (tStamped.child_frame_id || '');

        if (!parentFrame || !childFrame) {
            console.warn("[TF Callback] Received transform with empty frame ID, skipping.", tStamped);
            return;
        }

        // Add frames to our set
        if (!currentFrames.has(parentFrame)) {
            currentFrames.add(parentFrame);
            newFramesFound = true;
        }
         if (!currentFrames.has(childFrame)) {
            currentFrames.add(childFrame);
            newFramesFound = true;
        }

        // Create THREE.js objects from message data
        const transform: StoredTransform = {
          translation: new THREE.Vector3(
            tStamped.transform.translation.x,
            tStamped.transform.translation.y,
            tStamped.transform.translation.z
          ),
          rotation: new THREE.Quaternion(
            tStamped.transform.rotation.x,
            tStamped.transform.rotation.y,
            tStamped.transform.rotation.z,
            tStamped.transform.rotation.w
          ),
        };

        // Update Store: Compare using THREE.js equals methods for robustness
        const existingEntry = newTransforms[childFrame];
        if (!existingEntry || !isStatic || 
            !existingEntry.transform.translation.equals(transform.translation) || 
            !existingEntry.transform.rotation.equals(transform.rotation)) 
        {
           // console.log(`[TF Callback] Updating ${isStatic ? 'static' : 'dynamic'} transform: ${parentFrame} -> ${childFrame}`);
           newTransforms[childFrame] = { parentFrame, transform, isStatic };
           changed = true;
        }
      });

      // Only update state and provider if something actually changed
      if (changed) {
        // console.log("[TF Callback] Transforms changed, updating state and provider.");
        customTFProvider.current?.updateTransforms(newTransforms);
        return newTransforms;
      } else {
        // console.log("[TF Callback] No effective change in transforms.");
        return prevTransforms; // No change, return previous state
      }
    });

    // Update available frames state if new ones were found
    if (newFramesFound) {
        // console.log("[TF Callback] New frames found, updating availableFrames state.");
        setAvailableFrames(Array.from(currentFrames).sort()); // Convert Set to sorted Array
    }

  }, [availableFrames]); // Add availableFrames dependency

  // Effect to set the ID (same as before)
  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.id) {
      const uniqueId = `ros3d-viewer-${Math.random().toString(36).substring(2, 9)}`;
      viewerRef.current.id = uniqueId;
      // console.log(`Assigned unique ID to viewer div: ${uniqueId}`);
    }
  }, []);


  // Effect to fetch topics (same as before)
  useEffect(() => {
    if (ros && ros.isConnected) {
      // console.log('Fetching ROS topics for PointCloud2...');
      setFetchTopicsError(null);
      ros.getTopics(
        (response: { topics: string[]; types: string[] }) => {
          const pc2Topics: string[] = [];
          response.topics.forEach((topic, index) => {
            if (response.types[index] === 'sensor_msgs/PointCloud2' || response.types[index] === 'sensor_msgs/msg/PointCloud2') {
              pc2Topics.push(topic);
            }
          });
          // console.log(`Found PointCloud2 topics: ${pc2Topics.join(', ')}`);
          setAvailablePointCloudTopics(pc2Topics);
          if (pc2Topics.length === 0) {
            console.warn(`No topics found with type sensor_msgs/PointCloud2`);
          }
        },
        (error: any) => {
          console.error(`Failed to fetch topics:`, error);
          setFetchTopicsError(`Failed to fetch topics: ${error?.message || error}`);
          setAvailablePointCloudTopics([]);
        }
      );
    } else {
      setAvailablePointCloudTopics([]);
      setSelectedPointCloudTopic('');
      setFetchTopicsError('ROS not connected.');
       console.log('ROS disconnected, clearing topics.');
    }
  }, [ros, ros?.isConnected]);

  // Effect for ONE-TIME Viewer/Grid/Controls Setup & Teardown
  useEffect(() => {
    const currentViewerRef = viewerRef.current;
    let viewerInitializedThisEffect = false;
    let resizeObserver: ResizeObserver | null = null; // Add variable for ResizeObserver

    // --- Viewer Teardown Logic ---
    const cleanupViewer = () => {
        console.log('[Viewer Effect Cleanup] Cleaning up ROS3D viewer, Grid, OrbitControls, and ResizeObserver...');
        
        // Helper function to recursively dispose of resources in the scene graph
        const disposeSceneResources = (obj: THREE.Object3D) => {
            if (!obj) return;

            // Dispose children first
            if (obj.children && obj.children.length > 0) {
                // Iterate over a copy in case dispose modifies the children array
                [...obj.children].forEach(child => {
                    disposeSceneResources(child);
                    try {
                        obj.remove(child); // Remove child from parent after disposing
                    } catch (e) {
                        console.warn('[Viewer Cleanup] Error removing child object:', e);
                    }
                });
            }

            // Dispose geometry
            if ((obj as THREE.Mesh).geometry) {
                try {
                    (obj as THREE.Mesh).geometry.dispose();
                    // console.log(`[Viewer Cleanup] Disposed geometry for object: ${obj.uuid}`);
                } catch (e) {
                    console.warn('[Viewer Cleanup] Error disposing geometry:', e);
                }
            }

            // Dispose material(s)
            if ((obj as THREE.Mesh).material) {
                const material = (obj as THREE.Mesh).material;
                if (Array.isArray(material)) {
                    material.forEach((mat: THREE.Material) => {
                        try {
                            if (mat.map) mat.map.dispose(); // Dispose texture if present
                            mat.dispose();
                            // console.log(`[Viewer Cleanup] Disposed material in array: ${mat.uuid}`);
                        } catch (e) {
                            console.warn('[Viewer Cleanup] Error disposing material in array:', e);
                        }
                    });
                } else {
                    try {
                        if (material.map) material.map.dispose(); // Dispose texture if present
                        material.dispose();
                        // console.log(`[Viewer Cleanup] Disposed single material: ${material.uuid}`);
                    } catch (e) {
                        console.warn('[Viewer Cleanup] Error disposing single material:', e);
                    }
                }
            }
            
            // Dispose texture (if directly on the object, though less common)
            if ((obj as any).texture) {
                try {
                   (obj as any).texture.dispose();
                    // console.log(`[Viewer Cleanup] Disposed texture for object: ${obj.uuid}`);
                } catch (e) {
                    console.warn('[Viewer Cleanup] Error disposing texture:', e);
                }
            }
        };

        if (ros3dViewer.current) {
            try {
                // Remove objects from scene first (redundant if disposeSceneResources removes children, but safe)
                // if(gridClient.current) ros3dViewer.current.scene.remove(gridClient.current);
                // if(pointsClient.current) ros3dViewer.current.scene.remove(pointsClient.current);

                console.log('[Viewer Effect Cleanup] Destroying Viewer resources...');
                if (ros3dViewer.current.renderer) {
                    ros3dViewer.current.stop(); // Stop animation loop
                    
                    // Dispose scene contents recursively
                    if (ros3dViewer.current.scene) {
                       console.log('[Viewer Cleanup] Starting scene resource disposal...');
                       disposeSceneResources(ros3dViewer.current.scene);
                       console.log('[Viewer Cleanup] Finished scene resource disposal.');
                    }
                    
                    // Remove canvas from DOM
                    if (ros3dViewer.current.renderer.domElement.parentElement) {
                        ros3dViewer.current.renderer.domElement.parentElement.removeChild(ros3dViewer.current.renderer.domElement);
                    }
                    
                    // Dispose renderer itself
                    // ros3dViewer.current.scene?.dispose(); // REMOVED THIS LINE
                    ros3dViewer.current.renderer?.dispose();
                }
                console.log('[Viewer Effect Cleanup] Viewer resources likely released.');
            } catch(e) { 
                console.warn("[Viewer Effect Cleanup] Error during viewer cleanup", e); 
            }
        }
        ros3dViewer.current = null;
        gridClient.current = null;
        orbitControlsRef.current = null;
        console.log('[Viewer Effect Cleanup] Viewer refs nulled.');
    };

    // --- Viewer Setup Logic ---
    if (currentViewerRef?.id && ros && ros.isConnected) {
      // Only initialize if viewer doesn't exist yet
      if (!ros3dViewer.current) {
        console.log('[Viewer Effect] Initializing ROS3D Viewer, Grid, OrbitControls...');
        if (currentViewerRef.clientWidth > 0 && currentViewerRef.clientHeight > 0) {
            try {
              const viewer = new ROS3D.Viewer({
                divID: currentViewerRef.id,
                width: currentViewerRef.clientWidth, // Initial width
                height: currentViewerRef.clientHeight, // Initial height
                antialias: true,
                background: undefined as any,
                cameraPose: { x: 3, y: 3, z: 3 }
              });
              ros3dViewer.current = viewer;
              viewerInitializedThisEffect = true;
              console.log('[Viewer Effect] ROS3D.Viewer created.');

              gridClient.current = new ROS3D.Grid();
              viewer.addObject(gridClient.current);
              console.log('[Viewer Effect] ROS3D.Grid added.');

              if (ROS3D.OrbitControls) {
                orbitControlsRef.current = new ROS3D.OrbitControls({
                   scene: viewer.scene,
                   camera: viewer.camera,
                   userZoomSpeed: 0.2,
                   userPanSpeed: 0.2,
                   element: currentViewerRef // Use currentViewerRef here
                });
                console.log('[Viewer Effect] OrbitControls initialized.');
              } else { 
                  console.warn('[Viewer Effect] ROS3D.OrbitControls not found.'); 
              }

              // --- Setup Resize Observer ---
              resizeObserver = new ResizeObserver(entries => {
                  // Should only be one entry for our div
                  const entry = entries[0];
                  if (entry && ros3dViewer.current) {
                      const { width, height } = entry.contentRect;
                      // console.log(`[ResizeObserver] Detected size change: ${width}x${height}`);
                      if (width > 0 && height > 0) {
                          ros3dViewer.current.resize(width, height);
                          // console.log(`[ResizeObserver] ROS3D Viewer resized.`);
                      } else {
                          // console.log(`[ResizeObserver] Skipped resize due to zero dimension.`);
                      }
                  } else {
                      // console.log('[ResizeObserver] No entry or viewer not ready.');
                  }
              });
              resizeObserver.observe(currentViewerRef);
              console.log('[Viewer Effect] ResizeObserver is now observing the viewer container.');
              // ---------------------------

            } catch (error) {
               console.error("[Viewer Effect] Error initializing ROS3D Viewer/Components:", error);
               cleanupViewer(); // Cleanup on error
            }
        } else {
            console.warn('[Viewer Effect] Viewer div has zero width or height. Skipping initialization.');
        }
      }
    } else {
        console.log('[Viewer Effect] Prerequisites not met or ROS disconnected. Cleaning up viewer if it exists...');
        cleanupViewer(); // Cleanup if ROS disconnects or div not ready
    }

    // Return cleanup function specific to this effect
    return cleanupViewer;

  // Dependencies: Only run when ROS connects/disconnects or the component mounts/unmounts
  // viewerRef.current is stable, so not needed here. ros object identity might change on reconnect.
  }, [ros, ros?.isConnected]);


  // Effect for TF Provider and Subscriptions
  useEffect(() => {
      // --- TF Cleanup Logic ---
      const cleanupTf = () => {
          console.log('[TF Effect Cleanup] Cleaning up TF subscriptions and provider...');
          tfSub.current?.unsubscribe();
          tfSub.current = null;
          tfStaticSub.current?.unsubscribe();
          tfStaticSub.current = null;
          customTFProvider.current?.dispose();
          customTFProvider.current = null;
          console.log('[TF Effect Cleanup] TF refs nulled.');
      };

      // --- TF Setup Logic ---
      // Requires ROS connection AND the viewer to be initialized by the other effect
      if (ros && ros.isConnected && ros3dViewer.current) {
          console.log('[TF Effect] Prerequisites met (ROS connected, Viewer ready).');
          
          // Initialize or update Custom TF Provider
          if (!customTFProvider.current) {
              console.log(`[TF Effect] Initializing CustomTFProvider with fixedFrame: ${fixedFrame}`);
              // Use the current state of transforms when initializing
              customTFProvider.current = new CustomTFProvider(ros, fixedFrame, transforms); 
          } else {
              // console.log(`[TF Effect] Updating CustomTFProvider fixedFrame: ${fixedFrame}`);
              customTFProvider.current.updateFixedFrame(fixedFrame);
          }

          // Subscribe to TF topics if provider exists
          if (customTFProvider.current && !tfSub.current) {
              console.log('[TF Effect] Subscribing to /tf');
              tfSub.current = new ROSLIB.Topic({
                  ros: ros,
                  name: '/tf',
                  messageType: 'tf2_msgs/TFMessage',
                  throttle_rate: 100,
                  compression: 'none'
              });
              tfSub.current.subscribe((msg: any) => handleTFMessage(msg, false));
          }
          if (customTFProvider.current && !tfStaticSub.current) {
              console.log('[TF Effect] Subscribing to /tf_static');
              tfStaticSub.current = new ROSLIB.Topic({
                  ros: ros,
                  name: '/tf_static',
                  messageType: 'tf2_msgs/TFMessage',
                  throttle_rate: 0,
                  compression: 'none'
              });
              tfStaticSub.current.subscribe((msg: any) => handleTFMessage(msg, true));
          }
      } else {
           console.log('[TF Effect] Prerequisites not met (ROS or Viewer not ready). Cleaning up TF...');
           cleanupTf(); // Cleanup TF if prerequisites fail
      }

      // Return cleanup function specific to this effect
      return cleanupTf;

  // Dependencies: Re-run if ROS connects/disconnects, fixedFrame changes, or TF handler changes (stable)
  // We also depend on ros3dViewer.current existing, but refs aren't stable dependencies.
  // The check `if (ros3dViewer.current)` handles this internally.
  // Remove transforms state from dependencies to prevent loop.
  }, [ros, ros?.isConnected, fixedFrame, handleTFMessage]);


 // Separate effect for managing PointCloud2 client
 useEffect(() => {
    console.log('[PointCloud Effect] Running effect. Deps:', { rosConnected: ros?.isConnected, selectedPointCloudTopic, fixedFrame });

    // Capture the instance being created *specifically* in this effect run for targeted cleanup
    let createdClientInstance: ROS3D.PointCloud2 | null = null;

    // Cleanup function: Remove the specific pc client instance created by THIS effect run.
    const cleanupPointCloudClient = () => {
        const clientToClean = createdClientInstance; // Use the captured instance
        if (!clientToClean) {
            // console.log('[PointCloud Cleanup] No client instance captured for this effect run to clean.');
            return;
        }

        // console.log(`[PointCloud Cleanup] Cleaning up client instance...`); // Removed topic log

        // 0. Unsubscribe - REMOVED as ROS3D.PointCloud2 handles this internally
        // try {
        //     if (typeof clientToClean.unsubscribe === 'function') {
        //          clientToClean.unsubscribe();
        //          // console.log(`[PointCloud Cleanup] Unsubscribed client for topic: ${clientToClean.options?.topic}`);
        //     } else {
        //          console.warn(`[PointCloud Cleanup] Client object does not have an unsubscribe method?`, clientToClean);
        //     }
        // } catch (e) {
        //      console.error(`[PointCloud Cleanup] Error unsubscribing client for topic: ${clientToClean.options?.topic}`, e);
        // }

        // 1. Remove from Scene
        if (ros3dViewer.current?.scene) {
            // Get the internal THREE.Points object
            const pointsObject = (clientToClean as any)?.points?.object as THREE.Object3D | undefined; // THREE.Points extends Object3D
            if (pointsObject) {
                // Get the PARENT of the pointsObject, which is likely what ROS3D adds to the scene
                const wrapperObject = pointsObject.parent;
                if (wrapperObject && wrapperObject !== ros3dViewer.current.scene) { // Ensure parent exists and is not the scene itself
                    try {
                        const wrapperUUID = wrapperObject.uuid;
                        const sceneChildrenBefore = ros3dViewer.current.scene.children.map((c: THREE.Object3D) => ({ uuid: c.uuid, type: c.type }));
                        console.log(`[PointCloud Cleanup] Scene children BEFORE removing wrapper (${wrapperUUID}):`, sceneChildrenBefore);
                        ros3dViewer.current.scene.remove(wrapperObject); // <-- Remove the WRAPPER object
                        const sceneChildrenAfter = ros3dViewer.current.scene.children.map((c: THREE.Object3D) => ({ uuid: c.uuid, type: c.type }));
                        console.log(`[PointCloud Cleanup] Scene children AFTER removing wrapper (${wrapperUUID}):`, sceneChildrenAfter);
                    } catch(e){
                        console.error("[PointCloud Cleanup] Error removing wrapper object from scene", e);
                    }
                } else {
                   console.warn(`[PointCloud Cleanup] Could not find a valid parent wrapper object for pointsObject (uuid: ${pointsObject.uuid}) to remove from scene.`);
                   // Fallback: Try removing the pointsObject directly? (Might not work based on logs)
                   // try { ros3dViewer.current.scene.remove(pointsObject); } catch(e){} 
                }
            } else {
                console.warn(`[PointCloud Cleanup] Could not find internal points.object on the client to clean up.`);
            }
        } else {
             // console.log("[PointCloud Cleanup] Viewer or scene not available for removal.");
        }

        // 2. Dispose Geometry & Material
        // Access the internal ROS3D.Points wrapper
        const pointsWrapper = (clientToClean as any).points;

        if (pointsWrapper && pointsWrapper.object) { // Check if wrapper and its internal THREE.Points object exist
            const pointsObject = pointsWrapper.object as THREE.Points; // The actual THREE.Points mesh
            const clientUUID = pointsObject.uuid; // Get uuid from the THREE.Points object

            // Dispose Geometry
            if (pointsObject.geometry) {
                try {
                    pointsObject.geometry.dispose();
                    // console.log(`[PointCloud Cleanup] Disposed geometry for client ${clientUUID}`);
                } catch (e) {
                     console.error(`[PointCloud Cleanup] Error disposing geometry for client ${clientUUID}`, e);
                }
            } else {
                 // console.log(`[PointCloud Cleanup] No geometry found on pointsObject.object for client ${clientUUID}`);
            }

            // Dispose Material(s)
            if (pointsObject.material) {
                const material = pointsObject.material;
                 if (Array.isArray(material)) {
                     material.forEach((mat: THREE.Material) => {
                         try {
                             if (mat.map) mat.map.dispose(); // Dispose texture if present
                             mat.dispose();
                             // console.log(`[PointCloud Cleanup] Disposed material in array: ${mat.uuid}`);
                         } catch (e) {
                             console.warn('[PointCloud Cleanup] Error disposing material in array:', e);
                         }
                     });
                 } else {
                     try {
                         if (material.map) material.map.dispose(); // Dispose texture if present
                         material.dispose();
                         // console.log(`[PointCloud Cleanup] Disposed single material: ${material.uuid}`);
                     } catch (e) {
                         console.warn('[PointCloud Cleanup] Error disposing single material:', e);
                     }
                 }
            } else {
                // console.log(`[PointCloud Cleanup] No material found on pointsObject.object for client ${clientUUID}`);
            }

        } else {
            // Log if the expected structure isn't found
            const baseUUID = (clientToClean as any)?.uuid ?? 'unknown';
            if (!pointsWrapper) {
                 console.warn(`[PointCloud Cleanup] Internal 'points' wrapper not found for disposal on client ${baseUUID}.`);
            } else { // pointsWrapper exists, but pointsWrapper.object doesn't
                 // console.warn(`[PointCloud Cleanup] Internal nested 'object' not found within 'points' wrapper for disposal on client ${baseUUID}.`, pointsWrapper);
                 // This case seems to happen sometimes, potentially due to timing or ros3djs internal cleanup.
                 // Since we check for .object before disposing geometry/material, it's safe to just not log the warning.
            }
        }

        // 3. Nullify the reference for this specific cleanup closure
        createdClientInstance = null;
        // console.log('[PointCloud Cleanup] Nullified createdClientInstance ref.');
    };

    // --- Setup PointCloud Client ---
    // Prerequisite check: Ensure ROS is connected and Viewer/TFProvider are ready.
    if (!ros3dViewer.current || !ros || !ros.isConnected || !customTFProvider.current || !selectedPointCloudTopic) {
        // If a client *already* exists from a previous run, clean it up before returning
        if (pointsClient.current) { // Only cleanup if pointsClient.current actually exists
           console.log("[PointCloud Effect] Prerequisites failed OR no topic selected, cleaning up existing client if any.");
           // Use the existing cleanup logic - it now correctly handles disposal
           const existingClientCleanup = () => {
              const clientToClean = pointsClient.current; // Target the existing client
              if (!clientToClean) { console.log("[PointCloud Prereq Cleanup] No existing client to clean."); return; }

              console.log(`[PointCloud Prereq Cleanup] Cleaning up existing client: ${clientToClean.uuid}`);
 
               // 1. Remove from Scene
               if (ros3dViewer.current?.scene) {
                   // Also try removing the wrapper object here in the prerequisite cleanup
                   const pointsObject = (clientToClean as any)?.points?.object as THREE.Object3D | undefined;
                   if (pointsObject) {
                       const wrapperObject = pointsObject.parent;
                       if (wrapperObject && wrapperObject !== ros3dViewer.current.scene) {
                          try { ros3dViewer.current.scene.remove(wrapperObject); } catch(e){}
                       }
                   }
               }
               // 2. Dispose Geometry & Material
               const pointsWrapper = (clientToClean as any).points;
               if (pointsWrapper && pointsWrapper.object) {
                   const pointsObject = pointsWrapper.object as THREE.Points;
                   if (pointsObject.geometry) { try { pointsObject.geometry.dispose(); } catch(e){} }
                   if (pointsObject.material) {
                      const material = pointsObject.material;
                      if (Array.isArray(material)) { material.forEach((mat: any) => { try { if (mat.map) mat.map.dispose(); mat.dispose(); } catch(e){} }); }
                      else { try { if (material.map) material.map.dispose(); material.dispose(); } catch(e){} }
                   }
               }
               pointsClient.current = null; // Nullify the main ref
           };
           existingClientCleanup();
        }
        return; // Exit effect, don't setup or return cleanupPointCloudClient
    }

    // --- PointCloud Client Creation/Recreation Logic ---
    // 1. Always cleanup the *previous* client (if one exists in the main ref) before creating a new one.
    //    We use the refined cleanupPointCloudClient logic here by temporarily assigning
    //    the current client to createdClientInstance for cleanup.
    if (pointsClient.current) {
        // console.log(`[PointCloud Effect] Re-running/Topic change. Cleaning up existing client:`, pointsClient.current);
        console.log(`[PointCloud Effect] Cleaning up previous client: ${pointsClient.current.uuid}`);
        createdClientInstance = pointsClient.current; // Target the existing client for cleanup
        cleanupPointCloudClient();                    // Run the standard cleanup
        createdClientInstance = null;                 // Reset captured instance
        pointsClient.current = null;                  // Nullify the main ref *before* creating the new one
    }
    
    // 2. Create the new client
    // console.log(`[PointCloud Effect] Setting up new ROS3D.PointCloud2 client for topic: ${selectedPointCloudTopic}`);
    const options = {
         ros: ros,
         tfClient: customTFProvider.current, 
         rootObject: ros3dViewer.current.scene,
         topic: selectedPointCloudTopic,
         material: { size: 0.05, color: 0x00ff00 },
         max_pts: 200000,
         throttle_rate: 100,
         compression: 'none' as const,
    };
    // console.log('[PointCloud Effect] Creating new ROS3D.PointCloud2 client with options:', { ...options, tfClient: 'CustomTFProvider Instance' });
    console.log(`[PointCloud Effect] Creating new client for topic: ${selectedPointCloudTopic}`);
    try {
       const newClient = new ROS3D.PointCloud2(options);
       // Note: The client is added to the scene internally by ROS3D via the rootObject option.
       // We log the scene children *after* the client is expected to have added its object.
       pointsClient.current = newClient;
       createdClientInstance = newClient;
 
       // Log scene children *after* adding
       // Use a small delay or interval to wait for the object to likely be added
       const checkSceneInterval = setInterval(() => {
           if (ros3dViewer.current?.scene) {
               const internalPointsObject = (newClient as any)?.points?.object;
               // Check for the *parent* wrapper object in the scene now
               const wrapperObject = internalPointsObject?.parent;
               if (wrapperObject && ros3dViewer.current.scene.children.includes(wrapperObject)) {
                   console.log(`[PointCloud Effect] New client WRAPPER object found (uuid: ${wrapperObject.uuid}). Scene children:`);
                   const sceneChildrenAfterAdd = ros3dViewer.current.scene.children.map((c: THREE.Object3D) => ({ uuid: c.uuid, type: c.type }));
                   console.log(sceneChildrenAfterAdd);
                   clearInterval(checkSceneInterval);
               } else {
                   // console.log('[PointCloud Effect] Waiting for internal points object to appear...');
               }
           } else {
              console.warn('[PointCloud Effect] Viewer scene not available to log children after add.');
              clearInterval(checkSceneInterval); // Stop if viewer disappears
           }
       }, 100); // Check every 100ms

       // Clear interval on cleanup too
       const cleanupCheckInterval = () => clearInterval(checkSceneInterval);

       // Original frustum culling check
       const checkPointsObject = setInterval(() => {
            if (pointsClient.current?.points?.object) { // Optional chaining
                pointsClient.current.points.object.frustumCulled = false;
                // console.log('[PointCloud Debug] Set frustumCulled = false on internal points object.');
                clearInterval(checkPointsObject);
            }
       }, 100);

       // Cleanup function specific to the interval for THIS client instance
       const intervalCleanup = () => clearInterval(checkPointsObject);
       
       // Combined cleanup for THIS effect run (cleans interval AND removes the created client instance)
       const combinedCleanup = () => {
           intervalCleanup(); // Cleans frustum culling interval
           cleanupCheckInterval(); // Cleans scene check interval
           cleanupPointCloudClient(); // Uses createdClientInstance
       };
       return combinedCleanup; // Return the cleanup function for this effect instance

    } catch (error) {
       console.error(`[PointCloud Effect] Error creating ROS3D.PointCloud2 client for ${selectedPointCloudTopic}:`, error);
       pointsClient.current = null; // Ensure main ref is null if creation failed
       createdClientInstance = null; // Ensure captured instance is null on error
       // No specific cleanup needed here as nothing was added to the scene
    }

    // Fallback return (shouldn't be reached if try/catch handles returns properly)
    return undefined; 

  // Remove ros3dViewer.current and customTFProvider.current from dependencies
  }, [ros, ros?.isConnected, selectedPointCloudTopic, fixedFrame]); 


  // --- UI Handlers ---

  const toggleSettingsPopup = () => {
    setIsSettingsPopupOpen(!isSettingsPopupOpen);
  };

  // Handler for topic selection change (within popup)
  const handleTopicSelect = (topic: string) => {
    console.log(`Selected PointCloud topic: ${topic}`);
    setSelectedPointCloudTopic(topic);
    setIsTopicMenuOpen(false); // Close topic dropdown within popup
    // Consider closing the main popup too, or leave it open
    // setIsSettingsPopupOpen(false); 
  };

  // Handler for fixed frame input change (now a select element)
  const handleFixedFrameChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newFrame = event.target.value;
      setFixedFrame(newFrame || DEFAULT_FIXED_FRAME); // Use default if empty
      console.log("Fixed frame changed to:", newFrame || DEFAULT_FIXED_FRAME);
       // Consider closing the main popup after selection
      // setIsSettingsPopupOpen(false); 
  };


  // Toggle topic dropdown menu (within popup)
   const toggleTopicMenu = () => {
    setIsTopicMenuOpen(!isTopicMenuOpen);
  };

   // Effect to handle clicks outside the popups
   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close Topic Dropdown if open and click is outside
      if (isTopicMenuOpen && topicMenuRef.current && !topicMenuRef.current.contains(event.target as Node)) {
        setIsTopicMenuOpen(false);
      }
      // Close Settings Popup if open and click is outside
      if (isSettingsPopupOpen && settingsPopupRef.current && !settingsPopupRef.current.contains(event.target as Node)) {
          // Don't close if the click was on the settings button itself
          const settingsButton = document.getElementById('viz-settings-button');
          if (!settingsButton || !settingsButton.contains(event.target as Node)) {
             setIsSettingsPopupOpen(false);
          }
      }
    };

    // Add listener if either popup is open
    if (isTopicMenuOpen || isSettingsPopupOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    // Cleanup
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isTopicMenuOpen, isSettingsPopupOpen]); // Add isSettingsPopupOpen dependency



  // console.log(`--- VisualizationPanel Render End ---`);

  return (
    <div className="visualization-panel">
      {/* Settings Button */} 
      <button id="viz-settings-button" className="settings-button" onClick={toggleSettingsPopup}>
          {/* Simple Gear Icon (replace with SVG or icon library later) */}
          ⚙️ 
      </button>

      {/* Settings Popup (conditionally rendered) */} 
      {isSettingsPopupOpen && (
          <div className="settings-popup" ref={settingsPopupRef}>
              <h4>Visualization Settings</h4>
              
               {/* Fixed Frame Selector */}
               <div className="popup-control-item">
                 <label htmlFor="fixedFrameSelect">Fixed Frame:</label>
                 <select 
                   id="fixedFrameSelect" 
                   value={fixedFrame}
                   onChange={handleFixedFrameChange}
                 >
                   {availableFrames.length > 0 ? (
                       availableFrames.map((frame: string) => (
                           <option key={frame} value={frame}>
                               {frame}
                           </option>
                       ))
                   ) : (
                       <option value="" disabled>No frames available</option>
                   )}
                 </select>
               </div>

               {/* PointCloud Topic Selector */} 
               <div className="popup-control-item topic-selector-control" ref={topicMenuRef}>
                  <label>PointCloud Topic:</label> {/* Simple label */} 
                  <button onClick={toggleTopicMenu} className="topic-selector-button">
                     {selectedPointCloudTopic || 'Select PointCloud Topic'} <span className={`arrow ${isTopicMenuOpen ? 'up' : 'down'}`}></span>
                  </button>
                  {isTopicMenuOpen && (
                     <ul className="topic-selector-dropdown">
                       {fetchTopicsError ? (
                          <li className="topic-item error">{fetchTopicsError}</li>
                       ) : availablePointCloudTopics.length > 0 ? (
                         availablePointCloudTopics.map((topic: string) => (
                           <li key={topic} onClick={() => handleTopicSelect(topic)} className="topic-item">
                             {topic}
                           </li>
                         ))
                       ) : (
                         <li className="topic-item disabled">No PointCloud2 topics found</li>
                       )}
                     </ul>
                   )}
                </div>

                {/* Add more settings here if needed */}
          </div>
      )}

      {/* ROS3D Viewer Container (takes full space) */} 
      <div ref={viewerRef} className="ros3d-viewer">
        {/* Loading or connection status indicator (optional) */}
        {(!ros || !ros.isConnected) && <div className="viewer-overlay">Connecting to ROS...</div>}
        {ros && ros.isConnected && !selectedPointCloudTopic && <div className="viewer-overlay">Select a PointCloud topic</div>}
         {/* Error Indicator */}
         {fetchTopicsError && /* Don't show overlay if popup is open? Or maybe still show? */
             <div className="viewer-overlay error-overlay">Error fetching topics. Check ROS connection.</div>
         }
      </div>
    </div>
  );
});

export default VisualizationPanel;