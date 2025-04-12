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
  targetFrame = targetFrame.startsWith('/') ? targetFrame.substring(1) : targetFrame;
  sourceFrame = sourceFrame.startsWith('/') ? sourceFrame.substring(1) : sourceFrame;
  fixedFrame = fixedFrame.startsWith('/') ? fixedFrame.substring(1) : fixedFrame;

  // console.log(`[TF Logic] lookupTransform: ${sourceFrame} -> ${targetFrame} (fixed: ${fixedFrame})`);

  if (targetFrame === sourceFrame) {
    // Identity transform using THREE types
    return {
      translation: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Quaternion(0, 0, 0, 1),
    };
  }

  // Find path from source to target
  const path = findTransformPath(targetFrame, sourceFrame, transforms, fixedFrame);

  if (!path) {
     // console.warn(`[TF Logic] No path found from ${sourceFrame} to ${targetFrame}`);
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

  // console.log(`[TF Logic] Found transform for ${sourceFrame} -> ${targetFrame}`, finalTransform);
  return finalTransform;
}


// --- Custom TF Provider Class ---
// This class manages the TF tree using THREE types internally
// but provides an interface compatible with ros3djs (expecting ROSLIB.Transform-like structure in callback)
class CustomTFProvider {
    private ros: Ros;
    private fixedFrame: string;
    private transforms: TransformStore; // Stores THREE.Vector3 and THREE.Quaternion
    private callbacks: Map<string, Set<(transform: ROSLIB.Transform | null) => void>>; // Callbacks expect ROSLIB structure

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
                // Lookup using THREE types
                const latestTransformTHREE = this.lookupTransform(this.fixedFrame, frameId);
                // Convert to ROSLIB structure for the callback
                const latestTransformROSLIB = latestTransformTHREE
                  ? new ROSLIB.Transform({
                      translation: { x: latestTransformTHREE.translation.x, y: latestTransformTHREE.translation.y, z: latestTransformTHREE.translation.z },
                      rotation: { x: latestTransformTHREE.rotation.x, y: latestTransformTHREE.rotation.y, z: latestTransformTHREE.rotation.z, w: latestTransformTHREE.rotation.w }
                    })
                  : null;
                // console.log(`[CustomTFProvider] Notifying ${frameCallbacks.size} callbacks for frame ${frameId} with transform:`, latestTransformROSLIB);
                frameCallbacks.forEach(cb => {
                   try {
                     cb(latestTransformROSLIB);
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
                 const latestTransformROSLIB = latestTransformTHREE
                   ? new ROSLIB.Transform({ // Convert to ROSLIB structure
                       translation: { x: latestTransformTHREE.translation.x, y: latestTransformTHREE.translation.y, z: latestTransformTHREE.translation.z },
                       rotation: { x: latestTransformTHREE.rotation.x, y: latestTransformTHREE.rotation.y, z: latestTransformTHREE.rotation.z, w: latestTransformTHREE.rotation.w }
                     })
                   : null;
                 // console.log(`[CustomTFProvider] Re-notifying ${frameCallbacks.size} callbacks for frame ${frameId} due to fixedFrame change.`);
                 frameCallbacks.forEach(cb => {
                   try {
                     cb(latestTransformROSLIB);
                   } catch (e) {
                     console.error(`[CustomTFProvider] Error in TF callback for frame ${frameId} (fixedFrame update):`, e);
                   }
                 });
            });
        }
    }

    // This is the core method ros3djs components will call
    // It expects a callback function that takes a ROSLIB.Transform-like object or null
    subscribe(frameId: string, callback: (transform: ROSLIB.Transform | null) => void) {
        const normalizedFrameId = frameId.startsWith('/') ? frameId.substring(1) : frameId;
        // console.log(`[CustomTFProvider] subscribe called for frameId: ${normalizedFrameId}`);

        if (!this.callbacks.has(normalizedFrameId)) {
            this.callbacks.set(normalizedFrameId, new Set());
        }
        const frameCallbacks = this.callbacks.get(normalizedFrameId)!;
        frameCallbacks.add(callback);
        // console.log(`[CustomTFProvider] Added callback for ${normalizedFrameId}. Total callbacks: ${frameCallbacks.size}`);

        // Immediately provide the current transform, converted to ROSLIB structure
        const currentTransformTHREE = this.lookupTransform(this.fixedFrame, normalizedFrameId);
        const currentTransformROSLIB = currentTransformTHREE
            ? new ROSLIB.Transform({
                translation: { x: currentTransformTHREE.translation.x, y: currentTransformTHREE.translation.y, z: currentTransformTHREE.translation.z },
                rotation: { x: currentTransformTHREE.rotation.x, y: currentTransformTHREE.rotation.y, z: currentTransformTHREE.rotation.z, w: currentTransformTHREE.rotation.w }
              })
            : null;
        // console.log(`[CustomTFProvider] Providing initial transform for ${normalizedFrameId}:`, currentTransformROSLIB);
        try {
           callback(currentTransformROSLIB);
        } catch (e) {
           console.error(`[CustomTFProvider] Error in initial TF callback for frame ${normalizedFrameId}:`, e);
        }
    }

    // Unsubscribe remains the same, operating on frameId and callback reference
    unsubscribe(frameId: string, callback?: (transform: ROSLIB.Transform | null) => void) {
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

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({ ros }) => {
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

  // --- Callback for handling TF messages (populates store with THREE types) ---
  const handleTFMessage = useCallback((message: any /* tf2_msgs/TFMessage */, isStatic: boolean) => {
    // console.log(`[TF Callback] Received ${isStatic ? 'static' : 'dynamic'} TF message with ${message.transforms.length} transforms.`);
    setTransforms(prevTransforms => {
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
        customTFProvider.current?.updateTransforms(newTransforms); // Notify provider *after* state update cycle planned
        return newTransforms;
      } else {
        // console.log("[TF Callback] No effective change in transforms.");
        return prevTransforms; // No change, return previous state
      }
    });
  }, []); // No dependencies, relies on setTransforms closure

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
        
        // Disconnect observer first
        if (resizeObserver && currentViewerRef) {
            resizeObserver.unobserve(currentViewerRef);
            resizeObserver.disconnect();
            console.log('[Viewer Effect Cleanup] ResizeObserver disconnected.');
        }
        resizeObserver = null;

        if (ros3dViewer.current) {
            try {
                // Remove objects from scene first
                if(gridClient.current) ros3dViewer.current.scene.remove(gridClient.current);
                // If pointsClient exists, attempt removal (might be handled by its own effect's cleanup too)
                if(pointsClient.current) ros3dViewer.current.scene.remove(pointsClient.current);

                console.log('[Viewer Effect Cleanup] Destroying Viewer resources...');
                if (ros3dViewer.current.renderer) {
                    ros3dViewer.current.stop();
                    if (ros3dViewer.current.renderer.domElement.parentElement) {
                        ros3dViewer.current.renderer.domElement.parentElement.removeChild(ros3dViewer.current.renderer.domElement);
                    }
                    ros3dViewer.current.scene?.dispose();
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
    // Cleanup function: Remove pc client from scene, nullify ref.
    const cleanupPointCloudClient = () => {
      if (pointsClient.current) {
        // console.log(`Cleaning up ROS3D.PointCloud2 client for topic ${pointsClient.current.topicName}...`);
        if(ros3dViewer.current?.scene) {
            try {
                ros3dViewer.current.scene.remove(pointsClient.current); // Remove from scene
                // console.log('Removed ROS3D.PointCloud2 from scene.');
            } catch(e){ console.warn("Cleanup warning: Could not remove ROS3D.PointCloud2 client from scene", e); }
        }
         // REMOVED redundant/problematic unsubscribe call:
         // if (customTFProvider.current && pointsClient.current.options.frameID) { ... }

        pointsClient.current = null;
      }
    };

    // --- Setup PointCloud Client ---
    if (!ros3dViewer.current || !ros || !ros.isConnected || !customTFProvider.current || !selectedPointCloudTopic) {
        cleanupPointCloudClient();
        return;
    }

    // --- Create or update PointCloud2 client ---
    console.log(`[PointCloud Effect] Setting up ROS3D.PointCloud2 client for topic: ${selectedPointCloudTopic}`);

    if (pointsClient.current && pointsClient.current.topicName !== selectedPointCloudTopic) {
        console.log(`[PointCloud Effect] Topic changed (${pointsClient.current.topicName} -> ${selectedPointCloudTopic}). Cleaning up old client.`);
        cleanupPointCloudClient();
    }

    if (!pointsClient.current) {
        const options = {
             ros: ros,
             tfClient: customTFProvider.current, // Use the custom provider (which handles THREE types internally)
             rootObject: ros3dViewer.current.scene,
             topic: selectedPointCloudTopic,
             material: { size: 0.05, color: 0x00ff00 },
             max_pts: 200000,
             throttle_rate: 100,
             compression: 'none' as const,
        };
        console.log('[PointCloud Effect] Creating new ROS3D.PointCloud2 client with options:', { ...options, tfClient: 'CustomTFProvider Instance' });
        try {
           pointsClient.current = new ROS3D.PointCloud2(options);
           console.log(`[PointCloud Effect] ROS3D.PointCloud2 client created for ${selectedPointCloudTopic}.`);

            const checkPointsObject = setInterval(() => {
                if (pointsClient.current?.points?.object) { // Optional chaining
                    pointsClient.current.points.object.frustumCulled = false;
                    console.log('[PointCloud Debug] Set frustumCulled = false on internal points object.');
                    clearInterval(checkPointsObject);
                }
            }, 100);

            const intervalCleanup = () => clearInterval(checkPointsObject);
             const combinedCleanup = () => {
                 intervalCleanup();
                 cleanupPointCloudClient();
             };
             return combinedCleanup;

       } catch (error) {
           console.error(`[PointCloud Effect] Error creating ROS3D.PointCloud2 client for ${selectedPointCloudTopic}:`, error);
           pointsClient.current = null;
       }
    }

    return cleanupPointCloudClient;

  }, [ros, ros?.isConnected, ros3dViewer.current, customTFProvider.current, selectedPointCloudTopic]); // Dependencies


  // Handler for topic selection change
  const handleTopicSelect = (topic: string) => {
    console.log(`Selected PointCloud topic: ${topic}`);
    setSelectedPointCloudTopic(topic);
    setIsTopicMenuOpen(false); // Close menu after selection
  };

  // Handler for fixed frame input change
  const handleFixedFrameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      let newFrame = event.target.value.trim();
      setFixedFrame(newFrame || DEFAULT_FIXED_FRAME); // Use default if empty
      console.log("Fixed frame changed to:", newFrame || DEFAULT_FIXED_FRAME);
  };


  // Toggle topic dropdown menu
   const toggleTopicMenu = () => {
    setIsTopicMenuOpen(!isTopicMenuOpen);
  };

   // Effect to handle clicks outside the topic menu
   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (topicMenuRef.current && !topicMenuRef.current.contains(event.target as Node)) {
        setIsTopicMenuOpen(false);
      }
    };

    if (isTopicMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isTopicMenuOpen]);



  // console.log(`--- VisualizationPanel Render End ---`);

  return (
    <div className="visualization-panel">
      {/* Controls Container */}
      <div className="visualization-controls">
         {/* Fixed Frame Input */}
         <div className="control-item fixed-frame-control">
           <label htmlFor="fixedFrameInput">Fixed Frame:</label>
           <input
             id="fixedFrameInput"
             type="text"
             value={fixedFrame}
             onChange={handleFixedFrameChange}
             placeholder={DEFAULT_FIXED_FRAME}
           />
         </div>

         {/* Topic Selector Dropdown */}
         <div className="control-item topic-selector-control" ref={topicMenuRef}>
           <button onClick={toggleTopicMenu} className="topic-selector-button">
             {selectedPointCloudTopic || 'Select PointCloud Topic'} <span className={`arrow ${isTopicMenuOpen ? 'up' : 'down'}`}></span>
           </button>
           {isTopicMenuOpen && (
             <ul className="topic-selector-dropdown">
               {fetchTopicsError ? (
                  <li className="topic-item error">{fetchTopicsError}</li>
               ) : availablePointCloudTopics.length > 0 ? (
                 availablePointCloudTopics.map((topic) => (
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
      </div>

      {/* ROS3D Viewer Container */}
      <div ref={viewerRef} className="ros3d-viewer">
        {/* Loading or connection status indicator (optional) */}
        {(!ros || !ros.isConnected) && <div className="viewer-overlay">Connecting to ROS...</div>}
        {ros && ros.isConnected && !selectedPointCloudTopic && <div className="viewer-overlay">Select a PointCloud topic</div>}
         {/* Error Indicator */}
         {fetchTopicsError && !isTopicMenuOpen && /* Don't show overlay if menu is open */
             <div className="viewer-overlay error-overlay">Error fetching topics. Check ROS connection.</div>
         }
      </div>
    </div>
  );
});

export default VisualizationPanel;