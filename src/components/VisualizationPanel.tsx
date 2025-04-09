import React, { useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
// import * as THREE from 'three'; // Remove THREE if not used
import './VisualizationPanel.css'; // Create this next

// Define expected message type for PointCloud2
const POINTCLOUD2_MSG_TYPE = 'sensor_msgs/msg/PointCloud2';

interface VisualizationPanelProps {
  ros: Ros;
}

const VisualizationPanel: React.FC<VisualizationPanelProps> = ({ ros }: { ros: Ros | null }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  // Use ROS3D.Type for refs
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null);
  const pointCloudClient = useRef<any | null>(null);

  // State for topic selection
  const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>(''); // Start with no topic selected
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false); // State for popup menu
  const menuRef = useRef<HTMLDivElement>(null); // Ref for detecting outside clicks

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
      setFetchTopicsError(null); // Clear previous errors
      // Use type assertion for getTopicsForType and explicit types for callback params
      (ros as any).getTopicsForType(POINTCLOUD2_MSG_TYPE,
        (topics: string[]) => { // Explicitly type topics as string[] (expected)
          console.log(`Found PointCloud2 topics: ${topics.join(', ')}`);
          setAvailablePointCloudTopics(topics);
          // Optionally auto-select the first topic if none is selected
          if (topics.length > 0 && !selectedPointCloudTopic) {
             // setSelectedPointCloudTopic(topics[0]);
             // console.log(`Auto-selected PointCloud2 topic: ${topics[0]}`);
          }
           if (topics.length === 0) {
             console.warn(`No topics found with type ${POINTCLOUD2_MSG_TYPE}`);
           }
        },
        (error: any) => { // Explicitly type error as any
          console.error(`Failed to fetch topics for type ${POINTCLOUD2_MSG_TYPE}:`, error);
          setFetchTopicsError(`Failed to fetch topics: ${error?.message || error}`); // Get error message if possible
          setAvailablePointCloudTopics([]);
        }
      );
    } else {
      // Clear topics if ROS disconnects
      setAvailablePointCloudTopics([]);
      setSelectedPointCloudTopic('');
      setFetchTopicsError(null);
      setIsMenuOpen(false); // Close menu on disconnect
    }
  }, [ros, ros?.isConnected]); // Re-run when ROS connection status changes

  // Effect for ROS3D setup and cleanup
  useEffect(() => {
    const currentViewerRef = viewerRef.current; // Capture ref value for cleanup

    // Ensure the div exists, has an ID, and ROS is connected
    if (currentViewerRef?.id && ros && ros.isConnected) {

      // Initialize viewer only if it hasn't been initialized yet
      if (!ros3dViewer.current) {
        // console.log('Inspecting ROS3D object:', ROS3D);
        console.log('Initializing ROS3D Viewer on div#', currentViewerRef.id);
        try {
          const ViewerConstructor = (ROS3D as any).Viewer;
          const GridConstructor = (ROS3D as any).Grid;
          const PointCloud2Constructor = (ROS3D as any).PointCloud2;

          if (!ViewerConstructor) throw new Error("ROS3D.Viewer constructor not found!");
          const viewer = new ViewerConstructor({
            divID: currentViewerRef.id,
            width: currentViewerRef.clientWidth,
            height: currentViewerRef.clientHeight,
            antialias: true,
            background: undefined as any 
          });
          ros3dViewer.current = viewer;

          if (!GridConstructor) throw new Error("ROS3D.Grid constructor not found!");
          gridClient.current = new GridConstructor();
          viewer.addObject(gridClient.current);

          // Setup PointCloud Client (without explicit tfClient)
          if (selectedPointCloudTopic) {
            if (PointCloud2Constructor) {
              pointCloudClient.current = new PointCloud2Constructor({
                  ros: ros,
                  rootObject: viewer.scene, 
                  topic: selectedPointCloudTopic,
                  material: { size: 0.05, color: 0xff00ff }, 
                  max_pts: 10000 
              });
              console.log(`PointCloud client created for topic: ${selectedPointCloudTopic}`);
            } else {
                 console.error("ROS3D.PointCloud2 constructor not found (dynamic check)!");
            }
          } else {
            console.log("No PointCloud topic selected, client not created.");
          }

          console.log('ROS3D Viewer, Grid, and potentially PointCloud Client initialized.');

        } catch (error) {
          console.error("Error initializing ROS3D Viewer or clients:", error);
          // Clean up partial initialization
          if (pointCloudClient.current) {
             if (ros3dViewer.current?.scene) {
                // Access .points property if it exists
                const pointsMesh = pointCloudClient.current.points;
                if (pointsMesh) {
                   try { ros3dViewer.current.scene.remove(pointsMesh); } catch (e) {}
                }
             }
             pointCloudClient.current = null;
          }
          if(gridClient.current && ros3dViewer.current?.scene) {
             try { ros3dViewer.current.scene.remove(gridClient.current); } catch(e){}
             gridClient.current = null;
          }
          ros3dViewer.current = null;
          return;
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
        console.log('Cleaning up ROS3D Viewer and clients...');
        window.removeEventListener('resize', handleResize);

        // Cleanup PointCloud Client
        if (pointCloudClient.current) {
           console.log('Cleaning up PointCloud client...');
           // Important: Remove the points Mesh from the scene
           if (ros3dViewer.current?.scene && pointCloudClient.current.points) {
                try {
                    ros3dViewer.current.scene.remove(pointCloudClient.current.points);
                    console.log('PointCloud mesh removed from scene.');
                } catch (e) {
                    console.warn('Could not remove PointCloud mesh from scene during cleanup:', e);
                }
           }
           // PointCloud2 doesn't have unsubscribe. Nullifying ref is the main step.
           pointCloudClient.current = null;
        }

        // Cleanup Grid
        if (gridClient.current && ros3dViewer.current?.scene) {
           try { ros3dViewer.current.scene.remove(gridClient.current); } catch (e) { console.warn('Cleanup: Error removing grid', e); }
           gridClient.current = null;
        }

        // Destroy the viewer instance if it exists
        // Note: ROS3D.Viewer doesn't have an explicit destroy method.
        // Nullifying the reference is the main cleanup step here.
        // React will remove the div container from the DOM.
        if (ros3dViewer.current) {
          console.log('Setting ros3dViewer ref to null.');
          ros3dViewer.current = null;
        }
      };

    } else {
       // If ROS disconnects or div is not ready, ensure cleanup happens
       // This part handles the case where ROS disconnects while the panel is still mounted.
       console.log('ROS disconnected or viewerRef not ready. Ensuring cleanup.');
       // Cleanup PointCloud Client on disconnect
       if (pointCloudClient.current && ros3dViewer.current?.scene && pointCloudClient.current.points) {
           try {
               ros3dViewer.current.scene.remove(pointCloudClient.current.points);
           } catch(e) { /* ignore */ }
       }
       pointCloudClient.current = null;

       // Cleanup Grid on disconnect
       if (gridClient.current && ros3dViewer.current?.scene) {
         try { ros3dViewer.current.scene.remove(gridClient.current); } catch (e) { /* ignore */ }
         gridClient.current = null;
       }
       ros3dViewer.current = null; // Nullify viewer ref if ROS disconnects
    }

  // Dependencies: Re-run when ROS connection status changes or the ROS instance itself changes.
  // Adding ros?.isConnected ensures it runs correctly on connect/disconnect.
  // Added explicit 'ros' dependency due to direct check 'if (ros && ...)'
  }, [ros, ros?.isConnected]); // Ensure effect runs on connection changes

  // Handler for topic selection change
  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedPointCloudTopic(event.target.value);
    setIsMenuOpen(false); // Close menu after selection
  };

  // Toggle menu visibility
  const toggleMenu = () => {
      setIsMenuOpen((prev: boolean) => !prev);
  };

  // Close menu if clicked outside
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
              setIsMenuOpen(false);
          }
      };

      if (isMenuOpen) {
          document.addEventListener('mousedown', handleClickOutside);
      } else {
          document.removeEventListener('mousedown', handleClickOutside);
      }

      return () => {
          document.removeEventListener('mousedown', handleClickOutside);
      };
  }, [isMenuOpen]);

  return (
    // Ensure the container takes up space
    <div ref={viewerRef} className="visualization-panel-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Corner button to open topic selector */} 
      {ros?.isConnected && (
          <div ref={menuRef} style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10 }}>
              {/* Button to toggle menu */} 
              <button 
                  onClick={toggleMenu}
                  className="topic-menu-button" // Add class for styling
                  title={selectedPointCloudTopic || "Select PointCloud Topic"}
                  style={{
                      background: 'rgba(40, 44, 52, 0.8)',
                      color: 'white',
                      border: '1px solid #555', 
                      borderRadius: '4px', 
                      padding: '5px 10px',
                      cursor: 'pointer',
                      maxWidth: '150px', // Prevent button getting too wide
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                  }}
              >
                   {/* Display icon or short text */} 
                   <span>{selectedPointCloudTopic ? selectedPointCloudTopic.split('/').pop() : "Topics"}</span>
                   <span style={{ marginLeft: '5px' }}>{isMenuOpen ? '▲' : '▼'}</span> 
              </button>

              {/* Popup Menu - Renders below the button */} 
              {isMenuOpen && (
                  <div className="topic-menu-popup" // Add class for styling
                      style={{
                          position: 'absolute',
                          top: '100%', // Position below the button
                          left: 0,
                          background: 'rgba(40, 44, 52, 0.95)',
                          border: '1px solid #555',
                          borderRadius: '4px',
                          marginTop: '2px',
                          padding: '5px',
                          maxHeight: '200px',
                          overflowY: 'auto'
                      }}
                  >
                      {fetchTopicsError && <div style={{ color: 'red', fontSize: '0.8em', padding: '5px' }}>{fetchTopicsError}</div>}
                      {availablePointCloudTopics.length === 0 && !fetchTopicsError && (
                          <div style={{ color: 'orange', fontSize: '0.8em', padding: '5px' }}>No PointCloud2 topics found.</div>
                      )}
                      {availablePointCloudTopics.length > 0 && (
                          <select 
                              value={selectedPointCloudTopic} 
                              onChange={handleTopicChange} 
                              size={Math.min(availablePointCloudTopics.length + 1, 8)} // Show list directly
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
      )}

      {/* Message shown when ROS is not connected OR no topic selected */}
      {(!ros?.isConnected || !selectedPointCloudTopic) && (
        <div className="viz-placeholder">
            {!ros?.isConnected 
                ? "Waiting for ROS connection..." 
                : "Please select a PointCloud topic from the dropdown."
            }
            </div>
      )}
      {/* The ROS3D viewer will attach its canvas inside the div above */}
    </div>
  );
};

export default VisualizationPanel; 