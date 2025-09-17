import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
// Revert to using namespace for roslib types
import { Ros } from 'roslib'; 
import * as ROSLIB from 'roslib';
import * as ROS3D from '../utils/ros3d';
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
import LaserScanSettings, { LaserScanSettingsOptions } from './visualizers/LaserScanSettings'; // Import LaserScanSettings
import PoseStampedSettings, { PoseStampedSettingsOptions } from './visualizers/PoseStampedSettings'; // Import PoseStampedSettings
import './visualizers/TopicSettings.css';

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
import UrdfViz from './visualizers/UrdfViz'; // Import UrdfViz
import LaserScanViz, { LaserScanOptions } from './visualizers/LaserScanViz'; // Import LaserScanViz
import PoseStampedViz from './visualizers/PoseStampedViz'; // Import PoseStampedViz
import { PoseStampedOptions } from '../hooks/usePoseStampedClient'; // Import PoseStampedOptions
import { FaPlus, FaCog, FaCube } from 'react-icons/fa'; // Import icons, added FaCube for URDF

import {
  saveVisualizationState,
  getVisualizationState
} from '../utils/visualizationState';

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
}

// Define the structure for a visualization configuration
export interface VisualizationConfig {
  id: string;
  type: 'pointcloud' | 'camerainfo' | 'urdf' | 'laserscan' | 'tf' | 'posestamped'; // Added 'laserscan', 'tf', and 'posestamped'
  topic: string; // For pointcloud/camerainfo/laserscan/posestamped. For URDF, this might be robot_description topic
  options?: PointCloudOptions | CameraInfoOptions | UrdfOptions | LaserScanOptions | LaserScanSettingsOptions | PoseStampedOptions | PoseStampedSettingsOptions; // Union of option types
}

// Define more specific option types
export interface PointCloudOptions extends PointCloudSettingsOptions {}
export interface CameraInfoOptions {
  lineColor?: THREE.Color | number | string;
  lineScale?: number;
}
export interface UrdfOptions {
  robotDescriptionTopic?: string;
  urdfPath?: string;
  // Add other URDF specific options here, e.g., loaderType
}

// LaserScanOptions are already imported from LaserScanViz.tsx

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
  const [tfAxesScale, setTfAxesScale] = useState<number>(0.5); // Add TF axes scale state

  // UI State
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
  const [isAddVizModalOpen, setIsAddVizModalOpen] = useState(false); // Add modal state
  
  // Add state for point cloud settings popup
  const [activeSettingsVizId, setActiveSettingsVizId] = useState<string | null>(null);

  // State for modular visualizations
  const [visualizations, setVisualizations] = useState<VisualizationConfig[]>([]);
  const [allTopics, setAllTopics] = useState<TopicInfo[]>([]); // Store all topics
  
  // Add a ref to track TF provider initialization to prevent repeated logging
  const tfProviderInitialized = useRef<boolean>(false);

  // Load saved visualizations on initial mount
  useEffect(() => {
    const savedState = getVisualizationState();
    if (savedState.visualizations && savedState.visualizations.length > 0) {
      const validTypes: VisualizationConfig['type'][] = ['pointcloud', 'camerainfo', 'urdf', 'laserscan', 'tf', 'posestamped'];
      const filteredVisualizations = savedState.visualizations.filter(
        (viz: any) => validTypes.includes(viz.type)
      ) as VisualizationConfig[];
      
      setVisualizations(filteredVisualizations);
      setFixedFrame(savedState.fixedFrame || DEFAULT_FIXED_FRAME);
      setDisplayedTfFrames(savedState.displayedTfFrames || []);
      console.log('Restored and filtered saved visualization state:', savedState, 'Filtered:', filteredVisualizations);
    } else {
      // Initialize with some default visualization if none are saved (optional)
      // setVisualizations([
      //   { id: uuidv4(), type: 'pointcloud', topic: '/your_default_pointcloud_topic', options: {} },
      // ]);
    }
  }, []);

  // Save visualization state whenever visualizations, fixed frame, or displayed TF frames change
  useEffect(() => {
    if (isRosConnected) {
      const stateToSave = {
        visualizations,
        fixedFrame,
        displayedTfFrames
      };
      saveVisualizationState(stateToSave);
      console.log('Saved visualization state:', stateToSave);
    }
  }, [visualizations, fixedFrame, displayedTfFrames, isRosConnected]);

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

  // Update the TF provider hook call
  const { customTFProvider, ensureProviderFunctionality } = useTfProvider({
    ros,
    isRosConnected,
    ros3dViewer, // Pass viewer ref from the other hook
    fixedFrame,
    initialTransforms: transforms, // Pass current transforms state for initial setup
    handleTFMessage, // Pass the callback
  });
  
  // Add an effect to ensure TF provider is properly initialized
  useEffect(() => {
    if (isRosConnected && customTFProvider.current && !tfProviderInitialized.current) {
      // Ensure the TF provider has all required methods
      const isProviderValid = ensureProviderFunctionality();
      if (isProviderValid) {
        console.log("[VisualizationPanel] TF provider initialized successfully");
        tfProviderInitialized.current = true; // Mark as initialized to prevent repeated logging
      } else {
        console.error("[VisualizationPanel] TF provider initialization failed");
      }
    }
    
    // Reset the flag when ROS disconnects
    if (!isRosConnected) {
      tfProviderInitialized.current = false;
    }
  }, [isRosConnected, customTFProvider, ensureProviderFunctionality]);

  // REMOVED Direct PointCloud Client Hook Call
  // usePointCloudClient({ ... });

  // TF Visualizer Hook Call (Still direct)
  useTfVisualizer({
    isRosConnected,
    ros3dViewer,
    customTFProvider,
    displayedTfFrames,
    axesScale: tfAxesScale, // Use the state value for axes scale
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
      prev.map(viz => {
        if (viz.id === vizId) {
          if (viz.type === 'urdf') {
            // For URDF, update both topic and options.robotDescriptionTopic
            return {
              ...viz,
              topic: newTopic,
              options: {
                ...(viz.options || {}),
                robotDescriptionTopic: newTopic,
              },
            };
          } else if (viz.type === 'tf') {
            return viz; // TF has no topic to update, so return as is
          } else {
            return { ...viz, topic: newTopic };
          }
        }
        return viz;
      })
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
    const newFixedFrame = event.target.value;
    console.log(`[VisualizationPanel] Changing fixed frame from ${fixedFrame} to: ${newFixedFrame}`);
    
    // Update state first
    setFixedFrame(newFixedFrame);
    
    // Keep a count of updated components for diagnostic purposes
    let updatedComponentCount = 0;
    
    try {
      // If we have a viewer, update its fixed frame 
      if (ros3dViewer.current) {
        ros3dViewer.current.fixedFrame = newFixedFrame;
        updatedComponentCount++;
        console.log(`[VisualizationPanel] Updated viewer fixed frame to: ${newFixedFrame}`);
      }
      
      // If we have a custom TF provider, update its fixed frame
      if (customTFProvider.current) {
        // This will trigger callbacks to all subscribers
        customTFProvider.current.updateFixedFrame(newFixedFrame);
        updatedComponentCount++;
        console.log(`[VisualizationPanel] Updated TF provider fixed frame to: ${newFixedFrame}`);
      }
      
      // Force a viewer render if possible
      if (ros3dViewer.current && typeof (ros3dViewer.current as any).render === 'function') {
        try {
          (ros3dViewer.current as any).render();
          console.log(`[VisualizationPanel] Forced viewer render after frame change`);
        } catch (e) {
          console.warn(`[VisualizationPanel] Error forcing viewer render:`, e);
        }
      }
      
      console.log(`[VisualizationPanel] Successfully changed fixed frame to: ${newFixedFrame} (${updatedComponentCount} components updated)`);
    } catch (error) {
      console.error(`[VisualizationPanel] Error updating fixed frame:`, error);
    }
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
          
          // Debug: Log PoseStamped topics specifically
          const poseStampedTopics = fetchedTopics.filter(topic => 
            topic.type === 'geometry_msgs/PoseStamped' || topic.type === 'geometry_msgs/msg/PoseStamped'
          );
          console.log('[VisualizationPanel] Found PoseStamped topics:', poseStampedTopics);
          
          // Debug: Log all topics and types
          console.log('[VisualizationPanel] All discovered topics:');
          fetchedTopics.forEach(topic => {
            console.log(`  - ${topic.name}: ${topic.type}`);
          });
          
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
                fixedFrame={fixedFrame}
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
        } else if (viz.type === 'urdf') { // Added URDF rendering
          return (
            <React.Fragment key={viz.id}>
              <UrdfViz
                ros={ros}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                robotDescriptionTopic={(viz.options as UrdfOptions)?.robotDescriptionTopic || viz.topic}
                urdfPath={(viz.options as UrdfOptions)?.urdfPath}
                // Pass other URDF options as needed
              />
            </React.Fragment>
          );
        } else if (viz.type === 'laserscan') {
          return (
            <React.Fragment key={viz.id}>
              <LaserScanViz
                ros={ros}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                topic={viz.topic}
                fixedFrame={fixedFrame}
                options={viz.options as LaserScanOptions} // Cast options to LaserScanOptions
              />
            </React.Fragment>
          );
        } else if (viz.type === 'posestamped') {
          return (
            <React.Fragment key={viz.id}>
              <PoseStampedViz
                ros={ros}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                topic={viz.topic}
                fixedFrame={fixedFrame}
                options={viz.options as PoseStampedOptions}
              />
            </React.Fragment>
          );
        } else if (viz.type === 'tf') {
          // TF visualization is handled globally by the useTfVisualizer hook,
          // so we don't need to render a specific component here.
          // We keep this entry in the `visualizations` state to represent
          // that the user has chosen to display TFs.
          return null;
        }
        return null;
      })}

      {/* Main Viewer Div */}
      <div ref={viewerRef} className="viewer-container" id="ros3d-viewer-container"></div>

      {/* Settings Button */}
      <button
        id="viz-settings-button"
        className="icon-button visualization-settings-button"
        onClick={toggleSettingsPopup}
        title="Settings"
      >
        ⚙️
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
          tfAxesScale={tfAxesScale}
          onTfAxesScaleChange={(newScale: number) => setTfAxesScale(newScale)}
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

      {/* LaserScan Settings Popup */}
      {activeSettingsVizId && activeViz?.type === 'laserscan' && (
        <LaserScanSettings
          vizId={activeSettingsVizId}
          topic={activeViz.topic}
          initialOptions={activeViz.options as LaserScanSettingsOptions}
          onClose={closeVisualizationSettings}
          onSaveSettings={updateVisualizationSettings}
        />
      )}

      {/* PoseStamped Settings Popup */}
      {activeSettingsVizId && activeViz?.type === 'posestamped' && (
        <PoseStampedSettings
          vizId={activeSettingsVizId}
          topic={activeViz.topic}
          initialOptions={activeViz.options as PoseStampedSettingsOptions}
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