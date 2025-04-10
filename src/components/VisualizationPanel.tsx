import React, { useEffect, useRef, useState, memo } from 'react';
import { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three';
import './VisualizationPanel.css';

// Define expected message type for PointCloud2
const POINTCLOUD2_MSG_TYPE = 'sensor_msgs/msg/PointCloud2';

interface VisualizationPanelProps {
  ros: Ros;
}

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({ ros }: { ros: Ros | null }) => {
  console.log(`--- VisualizationPanel Render Start ---`);
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null);
  const pointsObject = useRef<THREE.Points | null>(null); 
  const orbitControlsRef = useRef<any | null>(null);
  const pointCloudSub = useRef<ROSLIB.Topic | null>(null); 
  const pointsMaterialRef = useRef<THREE.PointsMaterial | null>(null); 

  // State for topic selection
  const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>('');
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);
  const [isTopicMenuOpen, setIsTopicMenuOpen] = useState(false);
  const topicMenuRef = useRef<HTMLDivElement>(null);

  // Effect to set the ID on the div once the ref is available
  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.id) {
      // Assign a unique ID if it doesn't have one
      viewerRef.current.id = `ros3d-viewer-${Math.random().toString(36).substring(7)}`;
      console.log(`Assigned ID: ${viewerRef.current.id}`);
    }
  }, []); // Runs once when the ref is attached

  // Effect to fetch PointCloud topics when ROS connects
  useEffect(() => {
    if (ros && ros.isConnected) {
      console.log('Fetching ROS topics for PointCloud2...');
      setFetchTopicsError(null);
      (ros as any).getTopicsForType(POINTCLOUD2_MSG_TYPE,
        (topics: string[]) => {
          console.log(`Found PointCloud2 topics: ${topics.join(', ')}`);
          setAvailablePointCloudTopics(topics);
          if (topics.length === 0) {
            console.warn(`No topics found with type ${POINTCLOUD2_MSG_TYPE}`);
          }
        },
        (error: any) => {
          console.error(`Failed to fetch topics for type ${POINTCLOUD2_MSG_TYPE}:`, error);
          setFetchTopicsError(`Failed to fetch topics: ${error?.message || error}`);
          setAvailablePointCloudTopics([]);
        }
      );
    } else {
      // Clear topics if ROS disconnects
      setAvailablePointCloudTopics([]);
      setSelectedPointCloudTopic('');
      setFetchTopicsError(null);
      setIsTopicMenuOpen(false); // Close menu on disconnect
    }
  }, [ros, ros?.isConnected]); // Re-run when ROS connection status changes

  // Main effect for ROS3D setup and cleanup
  useEffect(() => {
    const currentViewerRef = viewerRef.current;

    if (currentViewerRef?.id && ros && ros.isConnected) {
      if (!ros3dViewer.current) {
        console.log('Initializing ROS3D Viewer, Grid, OrbitControls on div#', currentViewerRef.id);
        try {
          const viewer = new ROS3D.Viewer({
            divID: currentViewerRef.id,
            width: currentViewerRef.clientWidth,
            height: currentViewerRef.clientHeight,
            antialias: true,
            background: undefined as any,
            cameraPose: { x: 3, y: 3, z: 3 } 
          });
          ros3dViewer.current = viewer;

          gridClient.current = new ROS3D.Grid();
          viewer.addObject(gridClient.current);

          if (ROS3D.OrbitControls && viewerRef.current) {
            orbitControlsRef.current = new ROS3D.OrbitControls({
               scene: viewer.scene,
               camera: viewer.camera,
               userZoomSpeed: 0.2,
               userPanSpeed: 0.2,
               element: viewerRef.current 
            });
            console.log('OrbitControls initialized.');
          } else {
            console.warn('ROS3D.OrbitControls not found or viewerRef not ready.');
          }
          console.log('ROS3D Viewer, Grid, and OrbitControls initialized.');

        } catch (error) {
          console.error("Error initializing ROS3D Viewer/Grid/Controls:", error);
          // Clean up partially initialized components
          if (orbitControlsRef.current) { orbitControlsRef.current = null; }
          if(gridClient.current && ros3dViewer.current?.scene) {
             try { ros3dViewer.current.scene.remove(gridClient.current); } catch(e){}
             gridClient.current = null;
          }
          if (ros3dViewer.current) { ros3dViewer.current = null; }
          return; // Stop if core components failed
        }
      }

      // Handle resize - Attach listener only after successful initialization
      const handleResize = () => {
          if (ros3dViewer.current && currentViewerRef) {
            ros3dViewer.current.resize(currentViewerRef.clientWidth, currentViewerRef.clientHeight);
        }
      };

      window.addEventListener('resize', handleResize);
      handleResize(); // Initial size setup

      // Cleanup function for this effect
      return () => {
          console.log('Cleaning up resources for main effect...'); // More specific log
          window.removeEventListener('resize', handleResize);

          // Keep Viewer, Grid, OrbitControls cleanup
          if (orbitControlsRef.current) {
             orbitControlsRef.current = null;
             console.log('Cleaned up OrbitControls.');
          }
          if (gridClient.current && ros3dViewer.current?.scene) {
             try { ros3dViewer.current.scene.remove(gridClient.current); } catch (e) { console.warn('Cleanup: Error removing grid', e); }
             gridClient.current = null;
          }
          if (ros3dViewer.current) {
            console.log('Setting ros3dViewer ref to null.');
            ros3dViewer.current = null;
          }
      };

    } else {
       console.log('ROS disconnected or viewerRef not ready. Ensuring full cleanup.');
       // Cleanup PointCloud Client on disconnect
       if (pointsObject.current && ros3dViewer.current?.scene && pointsObject.current) {
           try {
               ros3dViewer.current.scene.remove(pointsObject.current);
           } catch(e) { /* ignore */ }
       }
       pointsObject.current = null;
       
       // Cleanup OrbitControls on disconnect
       if (orbitControlsRef.current) {
           orbitControlsRef.current = null;
       }

       // Cleanup Grid on disconnect
       if (gridClient.current && ros3dViewer.current?.scene) {
         try { ros3dViewer.current.scene.remove(gridClient.current); } catch (e) { /* ignore */ }
         gridClient.current = null;
       }
       
       // Cleanup Viewer on disconnect
       if (ros3dViewer.current) {
           ros3dViewer.current = null;
       }
    }
  }, [ros, ros?.isConnected]);

  // Separate effect for managing PointCloud subscription and rendering
  useEffect(() => {
    // Ensure viewer, ROS, are ready, and a topic is selected
    if (!ros3dViewer.current || !ros || !ros.isConnected) {
        // ... cleanup existing pointsObject if prerequisites not met ...
        return;
    }

    // Cleanup function for this effect (unsubscribe and remove points)
    const cleanupSubscription = () => {
      if (pointCloudSub.current) {
        console.log(`Unsubscribing from ${pointCloudSub.current.name}`);
        pointCloudSub.current.unsubscribe();
        pointCloudSub.current = null;
      }
      if (pointsObject.current) {
        console.log('Removing points geometry from scene');
        if(ros3dViewer.current?.scene) {
            try { ros3dViewer.current.scene.remove(pointsObject.current); } catch(e){}
        }
        // Properly dispose of geometry and material if necessary
        if (pointsObject.current.geometry) pointsObject.current.geometry.dispose();
        pointsObject.current = null;
      }
      // Dispose of the material when subscription ends
      if (pointsMaterialRef.current) {
          pointsMaterialRef.current.dispose();
          pointsMaterialRef.current = null;
      }
    };

    // If a topic is selected, create subscription
    if (selectedPointCloudTopic) {
      console.log(`Setting up subscription for topic: ${selectedPointCloudTopic}`);
      
      // --- Create Material (once per subscription) --- 
      if (!pointsMaterialRef.current) {
          // Use the larger size from previous attempt
          pointsMaterialRef.current = new THREE.PointsMaterial({ color: 0x00ff00, size: 0.5 });
      }
      
      // --- Create roslib Subscription --- 
      pointCloudSub.current = new ROSLIB.Topic({
        ros: ros,
        name: selectedPointCloudTopic,
        messageType: POINTCLOUD2_MSG_TYPE,
        // Use 'none' compression (expects Base64 data string)
        compression: 'none', 
        throttle_rate: 100
      });
      pointCloudSub.current.hasLoggedData = false; // Add flag to prevent excessive logging

      pointCloudSub.current.subscribe((message: any) => {
        console.log("+++ Message received (Manual Processing) +++"); 
        if (!ros3dViewer.current?.scene) return;

        try {
            const { fields, data, point_step, row_step, width, height, is_dense, is_bigendian } = message;
            const numPoints = width * height;

            // Log raw data only once
            if (!pointCloudSub.current?.hasLoggedData) { 
                console.log("Raw data (first 64 chars, base64 string):", typeof data === 'string' ? data.substring(0, 64) + '...' : data);
                pointCloudSub.current.hasLoggedData = true;
            }

            // Decode Base64 string data into Uint8Array
            let dataView: DataView;
            try {
                if (typeof data !== 'string') {
                    throw new Error(`Expected PointCloud2 data as a Base64 string, received: ${typeof data}`);
                }
                const binaryString = window.atob(data);
                const len = binaryString.length;
                const uint8Buffer = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    uint8Buffer[i] = binaryString.charCodeAt(i);
                }
                dataView = new DataView(uint8Buffer.buffer, uint8Buffer.byteOffset, uint8Buffer.byteLength);
            } catch (conversionError) {
                 console.error("Error decoding/converting Base64 PointCloud2 data:", conversionError, data ? data.substring(0,64)+'...' : 'null');
                 return; 
            }

            // Find XYZ offsets dynamically
            let xOffset = -1, yOffset = -1, zOffset = -1;
            fields.forEach((field: any) => {
                if (field.name === 'x') { xOffset = field.offset; }
                if (field.name === 'y') { yOffset = field.offset; }
                if (field.name === 'z') { zOffset = field.offset; }
            });

            if (xOffset === -1 || yOffset === -1 || zOffset === -1) {
                 console.error("PointCloud2 message fields do not contain x, y, and z.", fields);
                 return; 
            }

            // Use a temporary array to store only valid, finite points
            const validPositions: number[] = [];
            let skippedPoints = 0;
            const littleEndian = !is_bigendian; 

            for (let i = 0; i < numPoints; i++) {
                const pointOffset = i * point_step;
                if (pointOffset + Math.max(xOffset, yOffset, zOffset) + 4 > dataView.byteLength) {
                    console.warn(`Point index ${i} results in offset out of bounds. Skipping remaining points.`);
                    break; 
                }
                const xVal = dataView.getFloat32(pointOffset + xOffset, littleEndian); 
                const yVal = dataView.getFloat32(pointOffset + yOffset, littleEndian); 
                const zVal = dataView.getFloat32(pointOffset + zOffset, littleEndian); 

                if (Number.isFinite(xVal) && Number.isFinite(yVal) && Number.isFinite(zVal)) {
                    validPositions.push(xVal, yVal, zVal);
                } else {
                    skippedPoints++;
                }
            }

            if (skippedPoints > 0) {
                console.warn(`Skipped ${skippedPoints} non-finite points.`);
            }

            const positions = new Float32Array(validPositions);

            if (positions.length === 0) { 
                console.warn("No valid finite points found in the message.");
                 if (pointsObject.current?.geometry) { // Clear existing points if necessary
                     pointsObject.current.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
                     pointsObject.current.geometry.attributes.position.needsUpdate = true;
                 }
                return;
            }
            
            // --- Create or Update THREE.Points --- 
            if (!pointsObject.current) {
                console.log(`Creating initial Points geometry with ${positions.length / 3} valid points.`);
                const geometry = new THREE.BufferGeometry();
                geometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); 
                geometry.computeBoundingSphere(); 

                if (!pointsMaterialRef.current) {
                    console.error("PointsMaterial not ready!");
                    return;
                }

                pointsObject.current = new THREE.Points(geometry, pointsMaterialRef.current);
                ros3dViewer.current.scene.add(pointsObject.current);
                console.log("THREE.Points object created and added to scene.");

            } else {
                // Subsequent messages: Update existing geometry
                const oldGeometry = pointsObject.current.geometry;
                oldGeometry.addAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); 
                oldGeometry.attributes.position.needsUpdate = true; // Mark attribute for update
                oldGeometry.computeBoundingSphere(); // Recompute bounds
            }
            // ------------------------------------

        } catch (e) {
            console.error("Error processing PointCloud2 message (manual):", e, message);
        }
      });
      console.log(`Subscribed to ${selectedPointCloudTopic} (manual processing)`);
      // ----------------------------------
    }

    return cleanupSubscription;
  }, [ros, ros?.isConnected, ros3dViewer.current, selectedPointCloudTopic]); 

  // Handler for topic selection change
  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedPointCloudTopic(event.target.value);
    setIsTopicMenuOpen(false); // Close menu after selection
  };

  // Toggle topic menu visibility
  const toggleTopicMenu = () => {
      setIsTopicMenuOpen((prev: boolean) => !prev);
  };

  // Close menus if clicked outside (simplified)
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (topicMenuRef.current && !topicMenuRef.current.contains(event.target as Node)) {
              setIsTopicMenuOpen(false);
          }
      };

      if (isTopicMenuOpen) { // Only check topic menu
          document.addEventListener('mousedown', handleClickOutside);
      } else {
          document.removeEventListener('mousedown', handleClickOutside);
      }

      return () => {
          document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [isTopicMenuOpen]); // Only depends on topic menu

  return (
    // Ensure the container takes up space
    <div ref={viewerRef} className="visualization-panel-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Control Buttons Area */} 
      {ros?.isConnected && (
          <div style={{ 
              position: 'absolute', 
              top: '10px', 
              left: '10px', 
              zIndex: 10, 
              display: 'flex', // Arrange controls horizontally
              gap: '10px'       // Add spacing between controls
          }}>
              
              {/* PointCloud Topic Selector */} 
              <div ref={topicMenuRef} style={{ position: 'relative' }}>
                   {/* Button to toggle menu */} 
                  <button 
                      onClick={toggleTopicMenu}
                      className="topic-menu-button" 
                      title={selectedPointCloudTopic || "Select PointCloud Topic"}
                      disabled={availablePointCloudTopics.length === 0}
                      style={{
                         background: 'rgba(40, 44, 52, 0.8)',
                         color: 'white',
                         border: '1px solid #555', 
                         borderRadius: '4px', 
                         padding: '5px 10px',
                         cursor: 'pointer',
                         maxWidth: '150px',
                         overflow: 'hidden',
                         textOverflow: 'ellipsis',
                         whiteSpace: 'nowrap'
                      }}
                  >
                       <span>{selectedPointCloudTopic ? selectedPointCloudTopic.split('/').pop() : "PC Topic"}</span>
                       <span style={{ marginLeft: '5px' }}>{isTopicMenuOpen ? '▲' : '▼'}</span> 
                  </button>
                  {isTopicMenuOpen && (
                      <div className="topic-menu-popup" 
                          style={{
                               position: 'absolute', top: '100%', left: 0,
                               background: 'rgba(40, 44, 52, 0.95)',
                               border: '1px solid #555', borderRadius: '4px',
                               marginTop: '2px', padding: '5px', maxHeight: '200px', overflowY: 'auto'
                          }}
                      >
                          {fetchTopicsError && <div style={{ padding: '5px', color: 'red' }}>{fetchTopicsError}</div>}
                          {availablePointCloudTopics.length === 0 && !fetchTopicsError && (
                              <div style={{ padding: '5px', color: 'orange' }}>No PointCloud2 topics found.</div>
                          )}
                          {availablePointCloudTopics.length > 0 && (
                              <select 
                                  value={selectedPointCloudTopic} 
                                  onChange={handleTopicChange} 
                                  size={Math.min(availablePointCloudTopics.length + 1, 8)}
                                  style={{ width: '100%', background: '#3a3f4b', color: 'white', border: 'none' }}
                              >
                                  <option value="" disabled={selectedPointCloudTopic !== ''}>-- Select Topic --</option>
                                  {availablePointCloudTopics.map((topic: string) => (
                                      <option key={topic} value={topic}>{topic}</option>
                                  ))}
                              </select>
                          )}
                      </div>
                  )}
              </div>

          </div>
      )}

      {/* Message shown when ROS is not connected OR no topic selected */}
      {(!ros?.isConnected || !selectedPointCloudTopic) && (
        <div className="viz-placeholder">
            {!ros?.isConnected 
                ? "Waiting for ROS connection..." 
                : "Please select PointCloud topic."
            }
            </div>
      )}
      {/* The ROS3D viewer will attach its canvas inside the div above */}
    </div>
  );
}); // Close memo HOC

export default VisualizationPanel; 