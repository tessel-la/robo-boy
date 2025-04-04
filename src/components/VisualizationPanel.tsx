import React, { useEffect, useRef } from 'react';
import type { Ros } from 'roslib';
import * as ROS3D from 'ros3d';
// import * as THREE from 'three'; // Remove THREE if not used
import './VisualizationPanel.css'; // Create this next

interface VisualizationPanelProps {
  ros: Ros;
}

const VisualizationPanel: React.FC<VisualizationPanelProps> = ({ ros }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const ros3dViewer = useRef<ROS3D.Viewer | null>(null);
  const tfClient = useRef<ROS3D.TfClient | null>(null);

  useEffect(() => {
    if (!viewerRef.current || !ros || !ros.isConnected) {
      // Cleanup existing viewer if ROS disconnects or component unmounts prematurely
      if (ros3dViewer.current) {
          try {
            // Attempt to remove the viewer's canvas from the DOM
            viewerRef.current?.removeChild(ros3dViewer.current.scene.domElement);
          } catch (e) {
              // Ignore errors if element is already gone
          }
          ros3dViewer.current = null;
      }
      if(tfClient.current) {
          tfClient.current.unsubscribe();
          tfClient.current = null;
      }
      return;
    }

    // Initialize viewer only once or if ros connection is re-established
    if (!ros3dViewer.current) {
        console.log('Initializing ROS3D Viewer');
        ros3dViewer.current = new ROS3D.Viewer({
            divID: viewerRef.current.id, // Assign an ID to the div
            width: viewerRef.current.clientWidth,
            height: viewerRef.current.clientHeight,
            antialias: true,
            background: 0x282c34 // Match dark theme background (adjust if needed)
        });

        // Add a grid
        ros3dViewer.current.addObject(new ROS3D.Grid());

        // Setup TF Client
        tfClient.current = new ROS3D.TfClient({
            ros: ros,
            angularThres: 0.01,
            transThres: 0.01,
            rate: 10.0, // Hz
            fixedFrame: '/odom' // Change this to your fixed frame
        });

        console.log('ROS3D Viewer and TF Client initialized.');
    }

    // Handle resize
    const handleResize = () => {
      if (ros3dViewer.current && viewerRef.current) {
        ros3dViewer.current.resize(viewerRef.current.clientWidth, viewerRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial size setup

    // Cleanup function
    return () => {
      console.log('Cleaning up ROS3D Viewer');
      window.removeEventListener('resize', handleResize);
      if (tfClient.current) {
        tfClient.current.unsubscribe(); // Unsubscribe TF client
        tfClient.current = null;
      }
       if (ros3dViewer.current && viewerRef.current) {
         try {
           // Attempt to remove the viewer's canvas from the DOM
           // viewerRef.current.removeChild(ros3dViewer.current.scene.domElement); // Sometimes causes issues on rapid unmount/remount
         } catch (e) {
             // Ignore errors if element is already gone
         }
       }
       // Don't null out ros3dViewer.current here if we want it to potentially persist across HMR
       // It will be nulled out if ROS disconnects (handled at the start of useEffect)
    };

  }, [ros, ros.isConnected]); // Re-run effect if ros instance or connection status changes

  // Add an ID to the div for ROS3D.Viewer
  useEffect(() => {
    if (viewerRef.current && !viewerRef.current.id) {
      viewerRef.current.id = 'ros3d-viewer-div';
    }
  }, []);

  return (
    <div ref={viewerRef} className="visualization-panel-container">
      {/* The ROS3D viewer will attach its canvas here */}
      {!ros?.isConnected && (
        <div className="viz-placeholder">Waiting for ROS connection...</div>
      )}
    </div>
  );
};

export default VisualizationPanel; 