import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
// Revert to using namespace for roslib types
import { Ros } from 'roslib'; 
import * as ROSLIB from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three'; // Keep THREE import for potential use, though ROS3D handles Points creation
import './VisualizationPanel.css';

// Import TF logic from the new utility file
import {
  TransformStore,
  StoredTransform,
  // CustomTFProvider // Provider is now managed by the hook
} from '../utils/tfUtils';

// Import the new SettingsPopup component
import SettingsPopup from './SettingsPopup';

// Import custom hook for viewer management
import { useRos3dViewer } from '../hooks/useRos3dViewer';
import { useTfProvider } from '../hooks/useTfProvider'; // Import the new hook
import { usePointCloudClient } from '../hooks/usePointCloudClient'; // Import the new hook

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
}

const DEFAULT_FIXED_FRAME = 'odom'; // Or your preferred default, e.g., 'map', 'base_link'

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({ ros }: VisualizationPanelProps) => {
  // console.log(`--- VisualizationPanel Render Start ---`);

  const viewerRef = useRef<HTMLDivElement>(null);

  // Use the custom hook for viewer management
  const isRosConnected = ros?.isConnected ?? false;
  const { ros3dViewer } = useRos3dViewer(viewerRef, isRosConnected);

  // --- State and Refs for other parts ---
  const [transforms, setTransforms] = useState<TransformStore>({});

  const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>('');
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);
  const [fixedFrame, setFixedFrame] = useState<string>(DEFAULT_FIXED_FRAME);
  const [availableFrames, setAvailableFrames] = useState<string[]>([DEFAULT_FIXED_FRAME]);
  
  // State for UI controls
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false); // NEW state for popup

  // --- Callback for handling TF messages (populates store & extracts frames) ---
  const handleTFMessage = useCallback((message: any, isStatic: boolean) => {
    let newFramesFound = false;
    // Use functional update for transforms state
    setTransforms((prevTransforms: TransformStore) => {
      // Initialize currentFrames based on the *latest* availableFrames via functional update
      let currentFrames = new Set<string>(); // Initialize fresh inside setTransforms
      const newTransforms = { ...prevTransforms };
      let changed = false;
      message.transforms.forEach((tStamped: any) => {
        const parentFrame = (tStamped.header.frame_id || '').startsWith('/') ? tStamped.header.frame_id.substring(1) : (tStamped.header.frame_id || '');
        const childFrame = (tStamped.child_frame_id || '').startsWith('/') ? tStamped.child_frame_id.substring(1) : (tStamped.child_frame_id || '');
        if (!parentFrame || !childFrame) { console.warn("[TF] Empty frame ID.", tStamped); return; }

        // Check against previous transform keys/frames already known *within this update*
        if (!currentFrames.has(parentFrame)) currentFrames.add(parentFrame);
        if (!currentFrames.has(childFrame)) currentFrames.add(childFrame);
        
        // Add frames to our set
        // We will determine if new frames were *actually* added later using setAvailableFrames
        const transform: StoredTransform = { translation: new THREE.Vector3(tStamped.transform.translation.x, tStamped.transform.translation.y, tStamped.transform.translation.z), rotation: new THREE.Quaternion(tStamped.transform.rotation.x, tStamped.transform.rotation.y, tStamped.transform.rotation.z, tStamped.transform.rotation.w) };
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
        // Use the provider's update method - provider now uses internal lookup
        customTFProvider.current?.updateTransforms(newTransforms);
        return newTransforms;
      } else {
        // console.log("[TF Callback] No effective change in transforms.");
        return prevTransforms; // No change, return previous state
      }
    });

    // Use functional update for availableFrames to ensure stability
    setAvailableFrames((prevAvailableFrames: string[]) => {
      const currentFramesSet = new Set(prevAvailableFrames);
      let newFramesAdded = false;
      // Re-iterate through transforms to add frames (could optimize later if needed)
      message.transforms.forEach((tStamped: any) => {
          const parentFrame = (tStamped.header.frame_id || '').startsWith('/') ? tStamped.header.frame_id.substring(1) : (tStamped.header.frame_id || '');
          const childFrame = (tStamped.child_frame_id || '').startsWith('/') ? tStamped.child_frame_id.substring(1) : (tStamped.child_frame_id || '');
          if(parentFrame && !currentFramesSet.has(parentFrame)) {
              currentFramesSet.add(parentFrame);
              newFramesAdded = true;
          }
          if(childFrame && !currentFramesSet.has(childFrame)) {
              currentFramesSet.add(childFrame);
              newFramesAdded = true;
          }
      });

      // Only return a new array if frames were actually added
      if (newFramesAdded) {
          // console.log('[TF Callback] New frames found, updating availableFrames state.');
          return Array.from(currentFramesSet).sort();
      } else {
          return prevAvailableFrames; // No change
      }
    });

  }, []); // No dependencies needed now for the callback itself

  // Call the TF provider hook
  const { customTFProvider } = useTfProvider({
    ros,
    isRosConnected,
    ros3dViewer, // Pass viewer ref from the other hook
    fixedFrame,
    initialTransforms: transforms, // Pass current transforms state for initial setup
    handleTFMessage, // Pass the callback
  });

  // PointCloud Client Hook Call
  usePointCloudClient({
    ros,
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    selectedPointCloudTopic,
  });

  // --- UI Handlers ---

  const toggleSettingsPopup = () => {
    setIsSettingsPopupOpen(!isSettingsPopupOpen);
  };

  // Handler for topic selection change (within popup)
  const handleTopicSelect = (topic: string) => {
    console.log(`Selected PointCloud topic: ${topic}`);
    setSelectedPointCloudTopic(topic);
    // SettingsPopup manages closing its own topic dropdown
    // setIsSettingsPopupOpen(false); // Optional: Close main popup on selection
  };

  // Handler for fixed frame input change (now a select element)
  const handleFixedFrameChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newFrame = event.target.value;
      setFixedFrame(newFrame || DEFAULT_FIXED_FRAME); // Use default if empty
      console.log("Fixed frame changed to:", newFrame || DEFAULT_FIXED_FRAME);
      // setIsSettingsPopupOpen(false); // Optional: Close main popup on selection
  };

  // Toggle topic dropdown menu (within popup)
   const toggleTopicMenu = () => {
    // This function is removed as it's now managed by SettingsPopup
  };

   // Effect to handle clicks outside the popups
   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close Settings Popup if open and click is outside
      // Use the ref attached to the SettingsPopup component's div
      const settingsPopupElement = document.querySelector('.settings-popup'); // Or pass ref down properly
      if (isSettingsPopupOpen && settingsPopupElement && !settingsPopupElement.contains(event.target as Node)) {
          // Don't close if the click was on the settings button itself
          const settingsButton = document.getElementById('viz-settings-button');
          if (!settingsButton || !settingsButton.contains(event.target as Node)) {
             setIsSettingsPopupOpen(false);
          }
      }
    };

    // Add listener if settings popup is open
    if (isSettingsPopupOpen) {
      const timerId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return () => {};

  }, [isSettingsPopupOpen]); // Only depends on the main popup state

  // Effect to fetch PointCloud topics
  useEffect(() => {
    if (ros && isRosConnected) {
      setFetchTopicsError(null);
      ros.getTopics(
        (response: { topics: string[]; types: string[] }) => {
          const pc2Topics: string[] = response.topics.filter((_, index) =>
             response.types[index] === 'sensor_msgs/PointCloud2' || response.types[index] === 'sensor_msgs/msg/PointCloud2'
          );
          setAvailablePointCloudTopics(pc2Topics);
          if (pc2Topics.length === 0) { console.warn(`No topics found with type sensor_msgs/PointCloud2`); }
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
      setFetchTopicsError(isRosConnected ? null : 'ROS not connected.');
    }
  }, [ros, isRosConnected]);

  // console.log(`--- VisualizationPanel Render End ---`);

  return (
    <div className="visualization-panel">
      {/* Settings Button */}
      <button id="viz-settings-button" className="settings-button" onClick={toggleSettingsPopup}>
          {/* Simple Gear Icon (replace with SVG or icon library later) */}
          ⚙️
      </button>

      {/* Container for the absolutely positioned popup */}
      {isSettingsPopupOpen && (
          <div 
              className="settings-popup-container"
              onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                  // Close only if clicking the container itself (background)
                  if (e.target === e.currentTarget) {
                      toggleSettingsPopup();
                  }
              }}
          >
              <SettingsPopup
                isOpen={isSettingsPopupOpen} // Still needed for internal logic/conditional rendering within Popup
                onClose={toggleSettingsPopup}
                fixedFrame={fixedFrame}
                availableFrames={availableFrames}
                onFixedFrameChange={handleFixedFrameChange}
                selectedPointCloudTopic={selectedPointCloudTopic}
                availablePointCloudTopics={availablePointCloudTopics}
                fetchTopicsError={fetchTopicsError}
                onTopicSelect={handleTopicSelect}
              />
          </div>
      )}

      {/* Container div for the hook to manage - assign static ID */}
      <div ref={viewerRef} id="ros3d-viewer" className="ros3d-viewer">
        {/* Loading or connection status indicator (optional) */}
        {(!ros || !isRosConnected) && <div className="viewer-overlay">Connecting to ROS...</div>}
        {ros && isRosConnected && !selectedPointCloudTopic && <div className="viewer-overlay">Select a PointCloud topic</div>}
         {/* Error Indicator */}
         {fetchTopicsError && /* Don't show overlay if popup is open? Or maybe still show? */
             <div className="viewer-overlay error-overlay">Error fetching topics. Check ROS connection.</div>
         }
      </div>
    </div>
  );
});

export default VisualizationPanel;