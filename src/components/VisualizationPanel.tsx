import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
// Revert to using namespace for roslib types
import { Ros } from 'roslib'; 
import * as ROSLIB from 'roslib';
import * as ROS3D from 'ros3d';
import * as THREE from 'three'; // Keep THREE import for potential use, though ROS3D handles Points creation
import './VisualizationPanel.css';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique keys

// Import TF logic from the new utility file
import {
  TransformStore,
  StoredTransform,
  CustomTFProvider, // Import provider CLASS now
} from '../utils/tfUtils';

// Import the new SettingsPopup component
import SettingsPopup from './SettingsPopup';
// Import AddVisualizationModal (will be created later)
import AddVisualizationModal from './AddVisualizationModal';
// Import the PointCloudSettings component
import PointCloudSettings, { PointCloudSettingsOptions } from './visualizers/PointCloudSettings';
import './visualizers/PointCloudSettings.css';

// Import custom hooks
import { useRos3dViewer } from '../hooks/useRos3dViewer';
import { useTfProvider } from '../hooks/useTfProvider';
// Hooks below are used by wrapper components, not directly here anymore
// import { usePointCloudClient } from '../hooks/usePointCloudClient';
import { useTfVisualizer } from '../hooks/useTfVisualizer';
// import { useCameraInfoVisualizer } from '../hooks/useCameraInfoVisualizer';

// Import Wrapper Components
import PointCloudViz from './visualizers/PointCloudViz';
import CameraInfoViz from './visualizers/CameraInfoViz';
import { FaPlus, FaCog } from 'react-icons/fa'; // Import icons

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
}

// Define the structure for a visualization configuration
export interface VisualizationConfig {
  id: string;
  type: 'pointcloud' | 'camerainfo'; // Expandable later
  topic: string;
  options?: Record<string, any>; // Use more specific types for each visualization type
}

// Define more specific option types
export interface PointCloudOptions extends PointCloudSettingsOptions {}
export interface CameraInfoOptions {
  scale?: number;
  color?: string;
}

// Define structure for storing fetched topics
interface TopicInfo {
    name: string;
    type: string;
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

  // Remove old topic states
  // const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  // const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>('');
  // const [availableCameraInfoTopics, setAvailableCameraInfoTopics] = useState<string[]>([]);
  // const [selectedCameraInfoTopic, setSelectedCameraInfoTopic] = useState<string | null>(null);
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);

  // Frame States
  const [fixedFrame, setFixedFrame] = useState<string>(DEFAULT_FIXED_FRAME);
  const [availableFrames, setAvailableFrames] = useState<string[]>([DEFAULT_FIXED_FRAME]);
  const [displayedTfFrames, setDisplayedTfFrames] = useState<string[]>([]);

  // UI State
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
  const [isAddVizModalOpen, setIsAddVizModalOpen] = useState(false); // Add modal state
  
  // Add state for point cloud settings popup
  const [activeSettingsVizId, setActiveSettingsVizId] = useState<string | null>(null);

  // State for modular visualizations
  const [visualizations, setVisualizations] = useState<VisualizationConfig[]>([]);
  const [allTopics, setAllTopics] = useState<TopicInfo[]>([]); // Store all topics

  // --- Callback for handling TF messages (populates store & extracts frames) ---
  const handleTFMessage = useCallback((message: any, isStatic: boolean) => {
    let newFramesFound = false;
    setTransforms((prevTransforms: TransformStore) => {
      let currentFrames = new Set<string>();
      const newTransforms = { ...prevTransforms };
      let changed = false;
      message.transforms.forEach((tStamped: any) => {
        const parentFrame = (tStamped.header.frame_id || '').startsWith('/') ? tStamped.header.frame_id.substring(1) : (tStamped.header.frame_id || '');
        const childFrame = (tStamped.child_frame_id || '').startsWith('/') ? tStamped.child_frame_id.substring(1) : (tStamped.child_frame_id || '');
        if (!parentFrame || !childFrame) { console.warn("[TF] Empty frame ID.", tStamped); return; }
        if (!currentFrames.has(parentFrame)) currentFrames.add(parentFrame);
        if (!currentFrames.has(childFrame)) currentFrames.add(childFrame);
        const transform: StoredTransform = { translation: new THREE.Vector3(tStamped.transform.translation.x, tStamped.transform.translation.y, tStamped.transform.translation.z), rotation: new THREE.Quaternion(tStamped.transform.rotation.x, tStamped.transform.rotation.y, tStamped.transform.rotation.z, tStamped.transform.rotation.w) };
        const existingEntry = newTransforms[childFrame];
        if (!existingEntry || !isStatic ||
            !existingEntry.transform.translation.equals(transform.translation) ||
            !existingEntry.transform.rotation.equals(transform.rotation))
        {
           newTransforms[childFrame] = { parentFrame, transform, isStatic };
           changed = true;
        }
      });
      if (changed) {
        customTFProvider.current?.updateTransforms(newTransforms);
        return newTransforms;
      } else {
        return prevTransforms;
      }
    });
    setAvailableFrames((prevAvailableFrames: string[]) => {
      const currentFramesSet = new Set(prevAvailableFrames);
      let newFramesAdded = false;
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
      if (newFramesAdded) {
          return Array.from(currentFramesSet).sort();
      } else {
          return prevAvailableFrames;
      }
    });
  }, []);

  // Call the TF provider hook
  const { customTFProvider } = useTfProvider({
    ros,
    isRosConnected,
    ros3dViewer, // Pass viewer ref from the other hook
    fixedFrame,
    initialTransforms: transforms, // Pass current transforms state for initial setup
    handleTFMessage, // Pass the callback
  });

  // REMOVED Direct PointCloud Client Hook Call
  // usePointCloudClient({ ... });

  // TF Visualizer Hook Call (Still direct)
  useTfVisualizer({
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    displayedTfFrames,
    // axesScale: 0.3,
  });

  // REMOVED Direct CameraInfo Visualizer Hook Call
  // useCameraInfoVisualizer({ ... });

  // --- Add/Remove Visualization Logic ---
  const addVisualization = (config: Omit<VisualizationConfig, 'id'>) => {
    const newViz: VisualizationConfig = { ...config, id: uuidv4() };
    setVisualizations((prev: VisualizationConfig[]) => [...prev, newViz]);
    setIsAddVizModalOpen(false); // Close modal after adding
    console.log("Added visualization:", newViz);
  };

  const removeVisualization = (idToRemove: string) => {
    setVisualizations((prev: VisualizationConfig[]) => prev.filter((viz: VisualizationConfig) => viz.id !== idToRemove));
    console.log("Removed visualization with ID:", idToRemove);
  };

  // Add function to update topic for an existing visualization
  const updateVisualizationTopic = (vizId: string, newTopic: string) => {
    setVisualizations(prev => 
      prev.map(viz => 
        viz.id === vizId 
          ? { ...viz, topic: newTopic } 
          : viz
      )
    );
    console.log(`Updated topic for visualization ${vizId} to: ${newTopic}`);
  };

  // --- UI Handlers ---
  const toggleSettingsPopup = () => setIsSettingsPopupOpen(prev => !prev);
  const toggleAddVizModal = () => setIsAddVizModalOpen(prev => !prev); // Define toggle for Add modal

  // Function to open settings popup for a specific visualization
  const openVisualizationSettings = (vizId: string) => {
    setActiveSettingsVizId(vizId);
  };
  
  // Function to close visualization settings popup
  const closeVisualizationSettings = () => {
    setActiveSettingsVizId(null);
  };

  // Function to update visualization settings
  const updateVisualizationSettings = (vizId: string, newOptions: any) => {
    setVisualizations(prev => 
      prev.map(viz => 
        viz.id === vizId 
          ? { ...viz, options: { ...viz.options, ...newOptions } } 
          : viz
      )
    );
    console.log(`Updated settings for visualization ${vizId}:`, newOptions);
  };

  // Remove old handlers
  // const handlePointCloudTopicSelect = ...
  // const handleCameraInfoTopicSelect = ...

  const handleFixedFrameChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newFrame = event.target.value;
      setFixedFrame(newFrame || DEFAULT_FIXED_FRAME);
      console.log("Fixed frame changed to:", newFrame || DEFAULT_FIXED_FRAME);
  };

  const handleDisplayedTfFramesChange = (selectedFrames: string[]) => {
    setDisplayedTfFrames(selectedFrames);
    console.log("Displayed TF frames changed to:", selectedFrames);
  };

   // Effect to handle clicks outside the popups
   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const settingsPopupElement = document.querySelector('.settings-popup');
      const settingsButton = document.getElementById('viz-settings-button');
      if (isSettingsPopupOpen && settingsPopupElement && !settingsPopupElement.contains(event.target as Node) &&
          (!settingsButton || !settingsButton.contains(event.target as Node))) {
        setIsSettingsPopupOpen(false);
      }
      const addVizModalElement = document.querySelector('.add-viz-modal');
      const addVizButton = document.getElementById('add-viz-button');
       if (isAddVizModalOpen && addVizModalElement && !addVizModalElement.contains(event.target as Node) &&
           (!addVizButton || !addVizButton.contains(event.target as Node))) {
         setIsAddVizModalOpen(false);
       }
       
       // Handle clicks outside the pointcloud settings popup
       const pcSettingsElement = document.querySelector('.point-cloud-settings-popup');
       if (activeSettingsVizId && pcSettingsElement && !pcSettingsElement.contains(event.target as Node)) {
         setActiveSettingsVizId(null);
       }
    };
    if (isSettingsPopupOpen || isAddVizModalOpen || activeSettingsVizId !== null) {
      const timerId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return () => {};
  }, [isSettingsPopupOpen, isAddVizModalOpen, activeSettingsVizId]);

  // --- Effect to fetch ALL topics ONCE ---
  useEffect(() => {
    if (ros && isRosConnected) {
      setFetchTopicsError(null);
      console.log('[VisualizationPanel] Fetching all topics...');
      ros.getTopics(
        (response: { topics: string[]; types: string[] }) => {
          console.log('[VisualizationPanel] Received all topics response:', response);
          const fetchedTopics: TopicInfo[] = response.topics.map((topic, index) => ({
            name: topic,
            type: response.types[index],
          }));
          setAllTopics(fetchedTopics);
          // REMOVED setting old available state
          // setAvailablePointCloudTopics(...);
          // setAvailableCameraInfoTopics(...);
          // console.warn checks removed as they are not critical here
        },
        (error: any) => {
          console.error('[VisualizationPanel] Error fetching topics:', error);
          setFetchTopicsError(`Error fetching topics: ${JSON.stringify(error)}`);
          setAllTopics([]); // Clear topics on error
          // REMOVED clearing old state
          // setAvailablePointCloudTopics([]);
          // setAvailableCameraInfoTopics([]);
        }
      );
    } else {
      setAllTopics([]); // Clear topics if not connected
      // REMOVED clearing old state
      // setAvailablePointCloudTopics([]);
      // setAvailableCameraInfoTopics([]);
      // setSelectedPointCloudTopic('');
      // setSelectedCameraInfoTopic(null);
      // setFetchTopicsError(isRosConnected ? null : 'ROS not connected.'); // Keep error logic if needed
    }
  }, [ros, isRosConnected]);

  // Get active visualization data for settings popup if needed
  const activeViz = activeSettingsVizId 
    ? visualizations.find(viz => viz.id === activeSettingsVizId) 
    : null;

  // console.log(`--- VisualizationPanel Render End ---`);

  return (
    <div className="visualization-panel">
      {/* Render Visualization Wrapper Components */}
      {visualizations.map((viz: VisualizationConfig) => {
        if (viz.type === 'pointcloud') {
          return (
            <React.Fragment key={viz.id}>
              <PointCloudViz
                ros={ros}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                topic={viz.topic}
                options={viz.options as PointCloudOptions}
              />
            </React.Fragment>
          );
        } else if (viz.type === 'camerainfo') {
          return (
            <CameraInfoViz
              key={viz.id}
              ros={ros}
              isRosConnected={isRosConnected}
              ros3dViewer={ros3dViewer}
              customTFProvider={customTFProvider}
              topic={viz.topic}
              options={viz.options as CameraInfoOptions}
            />
          );
        }
        // Add other visualization types here later
        return null;
      })}

      {/* Main Viewer Div */}
      <div ref={viewerRef} className="viewer-container" id="ros3d-viewer-container"></div>

      {/* Settings Button */}
      <button
        id="viz-settings-button" // Keep ID for outside click detection
        className="icon-button visualization-settings-button"
        onClick={toggleSettingsPopup}
        title="Settings"
      >
        ⚙️ {/* Using emoji for simplicity, replace with icon component if needed */}
      </button>

      {/* Settings Popup */}
      {isSettingsPopupOpen && (
        <SettingsPopup
          onClose={toggleSettingsPopup}
          fixedFrame={fixedFrame}
          availableFrames={availableFrames}
          displayedTfFrames={displayedTfFrames}
          onFixedFrameChange={handleFixedFrameChange}
          onDisplayedTfFramesChange={handleDisplayedTfFramesChange}
          activeVisualizations={visualizations}
          onRemoveVisualization={removeVisualization}
          onAddVisualizationClick={toggleAddVizModal}
          onEditVisualization={openVisualizationSettings}
          onUpdateVisualizationTopic={updateVisualizationTopic}
          allTopics={allTopics}
        />
      )}

      {/* Add Visualization Modal */}
      {isAddVizModalOpen && (
        <AddVisualizationModal
          isOpen={isAddVizModalOpen} // Pass state down
          allTopics={allTopics}
          onAddVisualization={addVisualization}
          onClose={toggleAddVizModal} // Use the toggle function to close
        />
      )}

      {/* Point Cloud Settings Popup - only show when a point cloud viz is selected */}
      {activeSettingsVizId && activeViz?.type === 'pointcloud' && (
        <PointCloudSettings
          vizId={activeSettingsVizId}
          topic={activeViz.topic}
          initialOptions={activeViz.options as PointCloudOptions}
          onClose={closeVisualizationSettings}
          onSaveSettings={updateVisualizationSettings}
        />
      )}

      {/* Display Errors */}
      {fetchTopicsError && <div className="error-display">{fetchTopicsError}</div>}
    </div>
  );
});

export default VisualizationPanel;