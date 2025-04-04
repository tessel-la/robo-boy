import React, { useState, useEffect } from 'react';
import { ConnectionParams } from '../App'; // Import types
import { useRos } from '../hooks/useRos'; // Import the hook
import './MainControlView.css';
// Import placeholder components (we'll create these next)
import CameraView from './CameraView'; // Import the new CameraView
import VisualizationPanel from './VisualizationPanel'; // Import the new VisualizationPanel
import ControlPanel from './ControlPanel'; // We will create this next

interface MainControlViewProps {
  connectionParams: ConnectionParams;
  onDisconnect: () => void;
}

type ViewMode = 'camera' | '3d';

const MainControlView: React.FC<MainControlViewProps> = ({ connectionParams, onDisconnect }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('camera');
  const { ros, isConnected, connect, disconnect } = useRos(); // Use the hook
  const [availableCameraTopics, setAvailableCameraTopics] = useState<string[]>([]);
  const [selectedCameraTopic, setSelectedCameraTopic] = useState<string>('');

  // Fetch topics when connected
  useEffect(() => {
    if (isConnected && ros) {
      console.log('Fetching ROS topics...');
      ros.getTopics(
        (response) => {
          console.log('Available topics:', response.topics);
          console.log('Corresponding types:', response.types);
          // Filter topics likely to be camera feeds based on type or name pattern
          // Note: Comparing types is more reliable but requires type info from getTopics.
          // ROS2 might require separate calls to get type info if not included in getTopics response.
          const imageTypes = ['sensor_msgs/Image', 'sensor_msgs/CompressedImage'];
          const potentialTopics = response.topics.filter((topic, index) => {
            const type = response.types[index];
            if (imageTypes.includes(type)) {
                return true;
            }
            // Fallback: Check for common naming patterns if type information is missing/incomplete
            return topic.includes('image_raw') || topic.includes('image_color') || topic.includes('image_compressed');
          });

          console.log('Found potential camera topics:', potentialTopics);
          setAvailableCameraTopics(potentialTopics);

          // Set default selection if available
          if (potentialTopics.length > 0 && !selectedCameraTopic) {
              // Try to find a common default or just take the first one
              const defaultTopic = potentialTopics.find(t => t.includes('/image_raw')) || potentialTopics[0];
              setSelectedCameraTopic(defaultTopic);
              console.log(`Default camera topic set to: ${defaultTopic}`);
          } else if (potentialTopics.length === 0) {
              console.warn('No potential camera topics found.');
              setSelectedCameraTopic(''); // Reset if no topics found
          }
        },
        (error) => {
          console.error('Failed to fetch ROS topics:', error);
          setAvailableCameraTopics([]);
          setSelectedCameraTopic('');
        }
      );
    } else {
      // Reset topics when disconnected
      setAvailableCameraTopics([]);
      setSelectedCameraTopic('');
    }
  }, [isConnected, ros]); // Re-run when connection status or ros instance changes

  // Connect on mount and disconnect on unmount or when connectionParams change
  useEffect(() => {
    if (connectionParams) {
      connect(connectionParams);
    }

    // Cleanup function for when the component unmounts or params change
    return () => {
      disconnect();
    };
    // Only re-run effect if connect/disconnect functions or connectionParams change
  }, [connect, disconnect, connectionParams]);

  const handleInternalDisconnect = () => {
    disconnect(); // Disconnect ROS
    onDisconnect(); // Call App's disconnect handler to go back to EntrySection
  };

  return (
    <div className="main-control-view">
      {/* Connection Status Indicator & Disconnect Button (MOVED INTO HEADER) */}
      {/* <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </div> */}
      {/* <button onClick={handleInternalDisconnect} className="disconnect-button">
        Disconnect
      </button> */}

      <div className="view-panel-container">
        <div className="view-header">
          {/* View Toggle Buttons */}
          <div className="view-toggle">
            <button onClick={() => setViewMode('camera')} className={viewMode === 'camera' ? 'active' : ''}>
              Camera
            </button>
            <button onClick={() => setViewMode('3d')} className={viewMode === '3d' ? 'active' : ''}>
              3D View
            </button>
          </div>

          {/* New container for Status and Disconnect on the right */}
          <div className="status-controls">
            <div 
              className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`} 
              title={isConnected ? 'Status: Connected' : 'Status: Disconnected'} // Tooltip
              aria-label={isConnected ? 'Status: Connected' : 'Status: Disconnected'} // Accessibility
              role="status" // Accessibility role
            >
              {/* Use updated flat icons */}
              {isConnected ? '✅' : '⚠️'}
            </div>
            <button 
              onClick={handleInternalDisconnect} 
              className="disconnect-button icon-button" // Add icon-button class for styling
              title="Disconnect" // Tooltip
              aria-label="Disconnect" // Accessibility
            >
              {/* Use updated flat icon */}
              ❌
            </button>
          </div>

          {/* Camera Topic Selector (REMOVED FROM HERE) */}
          {/* {viewMode === 'camera' && availableCameraTopics.length > 0 && (
            <div className="camera-topic-selector">
              <label htmlFor="camera-topic-select">Topic:</label>
              <select
                id="camera-topic-select"
                value={selectedCameraTopic}
                onChange={(e) => setSelectedCameraTopic(e.target.value)}
              >
                {availableCameraTopics.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
            </div>
          )} */}
        </div>

        {/* Conditionally render Camera or 3D View Component based on viewMode */}
        <div className="view-panel card">
          {viewMode === 'camera' ? (
            isConnected && ros && selectedCameraTopic ? (
              <CameraView 
                ros={ros} 
                cameraTopic={selectedCameraTopic} 
                // Pass available topics and selection handler down to CameraView
                availableTopics={availableCameraTopics}
                onTopicChange={setSelectedCameraTopic} 
              />
            ) : (
              <div className="placeholder">
                {isConnected ? (availableCameraTopics.length > 0 ? 'Select a camera topic' : 'No camera topics found') : 'Connecting to ROS...'}
              </div>
            )
          ) : (
            isConnected && ros ? (
              <VisualizationPanel ros={ros} />
            ) : (
              <div className="placeholder">Connecting to ROS...</div>
            )
          )}
        </div>
      </div>

      <div className="control-panel-container">
         <div className="control-panel card">
             {/* Pass ros instance and isConnected status to ControlPanel */} 
             {isConnected && ros ? (
                 <ControlPanel ros={ros} />
             ) : (
                 <div>Connecting to ROS...</div>
             )}
         </div>
      </div>
    </div>
  );
};

export default MainControlView; 