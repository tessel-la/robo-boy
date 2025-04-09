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
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const tfClient = useRef<ROS3D.TfClient | null>(null);
  const gridClient = useRef<ROS3D.Grid | null>(null); // Keep track of the grid
  // Use 'any' for the ref type due to potential type definition issues
  const pointCloudClient = useRef<any | null>(null);

  // State for topic selection
  const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>(''); // Start with no topic selected
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);

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
    }
  }, [ros, ros?.isConnected, selectedPointCloudTopic]); // Re-run when ROS connection status changes

  // Effect for ROS3D setup and cleanup
  useEffect(() => {
    const currentViewerRef = viewerRef.current; // Capture ref value for cleanup

    // Ensure the div exists, has an ID, and ROS is connected
    if (currentViewerRef?.id && ros && ros.isConnected) {

      // Initialize viewer only if it hasn't been initialized yet
      if (!ros3dViewer.current) {
        console.log('Initializing ROS3D Viewer on div#', currentViewerRef.id);
        try {
          const viewer = new ROS3D.Viewer({
            divID: currentViewerRef.id,
            width: currentViewerRef.clientWidth,
            height: currentViewerRef.clientHeight,
            antialias: true,
            // background: '#282c34' as any // Temporarily remove background option
          });
          ros3dViewer.current = viewer;

          // Add a grid
          gridClient.current = new ROS3D.Grid();
          viewer.addObject(gridClient.current);

          // Setup TF Client
          tfClient.current = new ROS3D.TfClient({
            ros: ros,
            angularThres: 0.01,
            transThres: 0.01,
            rate: 10.0,
            fixedFrame: '/odom' // IMPORTANT: Change this to your actual fixed frame
          });

          // Setup PointCloud Client if a topic is selected
          if (selectedPointCloudTopic) {
            // Use type assertion (as any) to bypass potential type errors
            const PointCloud2Constructor = (ROS3D as any).PointCloud2;
            if (PointCloud2Constructor) {
              pointCloudClient.current = new PointCloud2Constructor({
                  ros: ros,
                  tfClient: tfClient.current, // Use the TF client for correct positioning
                  rootObject: viewer.scene, // Add directly to the viewer's scene
                  topic: selectedPointCloudTopic,
                  material: { size: 0.05, color: 0xff00ff }, // Example material
                  max_pts: 10000 // Optional: limit points for performance
              });
              console.log(`PointCloud client created for topic: ${selectedPointCloudTopic}`);
            } else {
                 console.error("ROS3D.PointCloud2 constructor not found!");
            }
          } else {
            console.log("No PointCloud topic selected, client not created.");
          }

          console.log('ROS3D Viewer, TF Client, and potentially PointCloud Client initialized.');

        } catch (error) {
          console.error("Error initializing ROS3D Viewer or clients:", error);
          // Clean up partial initialization
          if (pointCloudClient.current) {
             // PointCloud client doesn't have an explicit unsubscribe/destroy
             // Need to remove it from the scene if added
             if (ros3dViewer.current?.scene) {
                 ros3dViewer.current.scene.remove(pointCloudClient.current.points);
             }
             pointCloudClient.current = null;
          }
          if (tfClient.current) {
            tfClient.current.unsubscribe();
            tfClient.current = null;
          }
          if(gridClient.current && ros3dViewer.current?.scene) {
             ros3dViewer.current.scene.remove(gridClient.current);
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

        if (tfClient.current) {
          tfClient.current.unsubscribe();
          console.log('TF Client unsubscribed.');
          tfClient.current = null;
        }

        // Remove the grid from the scene before destroying the viewer
        if (gridClient.current && ros3dViewer.current) {
          // Check if scene still exists - belt and suspenders
          if (ros3dViewer.current.scene) {
             try {
                ros3dViewer.current.scene.remove(gridClient.current);
                console.log('Grid removed from scene.');
             } catch(e) {
                 console.warn('Could not remove grid from scene during cleanup:', e);
             }
          }
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

       if (tfClient.current) {
         tfClient.current.unsubscribe();
         tfClient.current = null;
       }
       // Grid removal logic (same as above)
       if (gridClient.current && ros3dViewer.current?.scene) {
          try {
             ros3dViewer.current.scene.remove(gridClient.current);
          } catch(e) { /* ignore */ }
          gridClient.current = null;
       }
       ros3dViewer.current = null; // Nullify viewer ref if ROS disconnects
    }

  // Dependencies: Re-run when ROS connection status changes or the ROS instance itself changes.
  // Adding ros?.isConnected ensures it runs correctly on connect/disconnect.
  // Added explicit 'ros' dependency due to direct check 'if (ros && ...)'
  }, [ros, ros?.isConnected, selectedPointCloudTopic]); // Ensure effect runs on connection changes

  // Handler for topic selection change
  const handleTopicChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedPointCloudTopic(event.target.value);
  };

  return (
    // Ensure the container takes up space
    <div ref={viewerRef} className="visualization-panel-container" style={{ width: '100%', height: '100%' }}>
      {/* Topic Selection Dropdown - Overlay on top left */} 
      {ros?.isConnected && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 10, background: 'rgba(40, 44, 52, 0.8)', padding: '5px', borderRadius: '4px' }}>
              <select 
                  value={selectedPointCloudTopic}
                  onChange={handleTopicChange}
                  disabled={availablePointCloudTopics.length === 0}
                  style={{ background: '#3a3f4b', color: 'white', border: '1px solid #555', borderRadius: '3px' }}
              >
                  <option value="">-- Select PointCloud Topic --</option>
                  {availablePointCloudTopics.map((topic: string) => (
                      <option key={topic} value={topic}>{topic}</option>
                  ))}
              </select>
              {fetchTopicsError && <div style={{ color: 'red', fontSize: '0.8em', marginTop: '5px' }}>{fetchTopicsError}</div>}
              {availablePointCloudTopics.length === 0 && !fetchTopicsError && <div style={{ color: 'orange', fontSize: '0.8em', marginTop: '5px' }}>No PointCloud2 topics found.</div>}
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