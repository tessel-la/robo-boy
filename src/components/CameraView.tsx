import React, { useState, useEffect } from 'react';
import type { Ros } from 'roslib';
import './CameraView.css'; // We'll create this CSS file next

// Remove hardcoded URL
// const DEFAULT_ROSBRIDGE_URL = 'ws://localhost:9090'; 

interface CameraViewProps {
  ros: Ros;
  cameraTopic: string; // e.g., /camera/image_raw
  // webVideoServerPort?: number; // Default 8080
  streamType?: string; // Default mjpeg
  streamWidth?: number; // Optional
  streamHeight?: number; // Optional
  // Add new props for topic selection
  availableTopics: string[];
  onTopicChange: (newTopic: string) => void;
}

const CameraView: React.FC<CameraViewProps> = ({
  ros,
  cameraTopic,
  // webVideoServerPort = 8080, // Port is now handled by proxy
  streamType = 'mjpeg', 
  streamWidth,
  streamHeight,
  // Destructure new props
  availableTopics,
  onTopicChange,
}) => {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('[CameraView useEffect] Checking dependencies:', {
      rosExists: !!ros,
      isConnected: ros?.isConnected,
      cameraTopic: cameraTopic,
    });

    if (ros && ros.isConnected && cameraTopic) { // Ensure topic is selected
      try {
        // Construct relative URL using the Caddy proxy path
        let url = `/video_stream/stream?topic=${cameraTopic}`;
        if (streamType) {
          url += `&type=${streamType}`;
        }
        if (streamWidth) {
          url += `&width=${streamWidth}`;
        }
        if (streamHeight) {
          url += `&height=${streamHeight}`;
        }

        setStreamUrl(url);
        setError(null);
        console.log(`[CameraView] Relative stream URL set to: ${url}`);
      } catch (e) {
        console.error("[CameraView] Error constructing stream URL:", e);
        setError("Failed to construct stream URL.");
        setStreamUrl(null);
      }
    } else {
      setStreamUrl(null);
      setError(cameraTopic ? "Connecting..." : "No camera topic selected.");
    }
  }, [
    ros,
    ros?.isConnected,
    cameraTopic,
    // webVideoServerPort, // Removed dependency
    streamType,
    streamWidth,
    streamHeight,
  ]);

  return (
    <div className="camera-view">
      {/* Container now needs position relative for absolute positioning of dropdown */}
      <div className="camera-stream-container">
        {/* Add the dropdown selector inside the container */} 
        {availableTopics.length > 0 && (
          <div className="camera-topic-selector overlay">
            {/* <label htmlFor="camera-topic-select">Topic:</label> */}
            <select
              id="camera-topic-select"
              value={cameraTopic} // Use current cameraTopic prop
              onChange={(e) => onTopicChange(e.target.value)} // Use handler prop
            >
              {availableTopics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
          </div>
        )}
        
        {/* Existing error/image/placeholder rendering */}
        {error ? (
          <div className="error-message">{error}</div>
        ) : streamUrl ? (
          <img
            src={streamUrl}
            alt={`Stream for ${cameraTopic}`}
            onError={(e) => {
              console.error("Error loading video stream:", e);
              setError(
                // Update error message to reflect proxy
                `Failed to load stream via proxy (${streamUrl}). Check Caddyfile, web_video_server, topic (${cameraTopic}), and type (${streamType}).`
              );
            }}
          />
        ) : (
          <div className="placeholder">Waiting for stream URL...</div>
        )}
      </div>
      {/* Optional: Keep the title separate or remove it */}
      {/* <h4>Camera Feed ({cameraTopic})</h4> */}
    </div>
  );
};

export default CameraView; 