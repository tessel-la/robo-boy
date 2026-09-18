import React, { useEffect, useRef, useState, memo } from 'react';
// Revert to using namespace for roslib types
import { Ros } from 'roslib';
import * as THREE from 'three'; // Keep THREE import for potential use, though ROS3D handles Points creation
import './VisualizationPanel.css';
import { v4 as uuidv4 } from 'uuid'; // Import uuid for unique keys

// Import the new SettingsPopup component
import SettingsPopup from './SettingsPopup';
// Import AddVisualizationModal (will be created later)
import AddVisualizationModal from './AddVisualizationModal';
// Import the PointCloudSettings component
import PointCloudSettings, { PointCloudSettingsOptions } from './visualizers/PointCloudSettings';
import LaserScanSettings, { LaserScanSettingsOptions } from './visualizers/LaserScanSettings'; // Import LaserScanSettings
import PoseStampedSettings, { PoseStampedSettingsOptions } from './visualizers/PoseStampedSettings'; // Import PoseStampedSettings
import './visualizers/TopicSettings.css';
import TreePanelMenu from '../features/treePanel/components/TreePanelMenu';

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

import {
  getVisualizationStateForKey,
  pickTfDisplaySettings,
  saveVisualizationStateForKey,
  type TfDisplaySettings,
} from '../utils/visualizationState';

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
  storageKey?: string;
}

// Define the structure for a visualization configuration
export interface VisualizationConfig {
  id: string;
  type: 'pointcloud' | 'camerainfo' | 'urdf' | 'laserscan' | 'tf' | 'posestamped'; // Added 'laserscan', 'tf', and 'posestamped'
  topic: string; // For pointcloud/camerainfo/laserscan/posestamped. For URDF, this might be robot_description topic
  options?: PointCloudOptions | CameraInfoOptions | UrdfOptions | LaserScanOptions | LaserScanSettingsOptions | PoseStampedOptions | PoseStampedSettingsOptions; // Union of option types
}

// Define more specific option types
export interface PointCloudOptions extends PointCloudSettingsOptions { }
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

const VALID_VISUALIZATION_TYPES: VisualizationConfig['type'][] = [
  'pointcloud',
  'camerainfo',
  'urdf',
  'laserscan',
  'tf',
  'posestamped',
];

const DEFAULT_STORAGE_KEY = 'roboboy_3d_visualization_state';

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({
  ros,
  storageKey = DEFAULT_STORAGE_KEY,
}: VisualizationPanelProps) => {
  // console.log(`--- VisualizationPanel Render Start ---`);

  const panelRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerIdRef = useRef(`ros3d-viewer-${uuidv4()}`);
  const [initialState] = useState(() => {
    const savedState = getVisualizationStateForKey(storageKey);
    return {
      ...savedState,
      visualizations: savedState.visualizations.filter((viz) =>
        VALID_VISUALIZATION_TYPES.includes(viz.type as VisualizationConfig['type'])
      ) as VisualizationConfig[],
    };
  });

  // Use the custom hook for viewer management
  const isRosConnected = ros?.isConnected ?? false;
  const { ros3dViewer, viewerGeneration } = useRos3dViewer(viewerRef, isRosConnected);

  // Remove old topic states
  // const [availablePointCloudTopics, setAvailablePointCloudTopics] = useState<string[]>([]);
  // const [selectedPointCloudTopic, setSelectedPointCloudTopic] = useState<string>('');
  // const [availableCameraInfoTopics, setAvailableCameraInfoTopics] = useState<string[]>([]);
  // const [selectedCameraInfoTopic, setSelectedCameraInfoTopic] = useState<string | null>(null);
  const [fetchTopicsError, setFetchTopicsError] = useState<string | null>(null);

  // Frame States. `fixedFramePreference` is what the user picked ('' = auto); the frame the scene
  // is actually anchored to is resolved against the live TF tree below.
  const [fixedFramePreference, setFixedFramePreference] = useState<string>(initialState.fixedFrame);
  const [displayedTfFrames, setDisplayedTfFrames] = useState<string[]>(initialState.displayedTfFrames);
  const [showAllTfFrames, setShowAllTfFrames] = useState<boolean>(initialState.showAllTfFrames);
  const [tfDisplay, setTfDisplay] = useState<TfDisplaySettings>(() => pickTfDisplaySettings(initialState));
  const updateTfDisplay = (patch: Partial<TfDisplaySettings>) =>
    setTfDisplay(previous => ({ ...previous, ...patch }));

  // UI State
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
  const [isAddVizModalOpen, setIsAddVizModalOpen] = useState(false); // Add modal state

  // Add state for point cloud settings popup
  const [activeSettingsVizId, setActiveSettingsVizId] = useState<string | null>(null);

  // State for modular visualizations
  const [visualizations, setVisualizations] = useState<VisualizationConfig[]>(initialState.visualizations);
  const [allTopics, setAllTopics] = useState<TopicInfo[]>([]); // Store all topics

  // Save visualization state whenever visualizations, fixed frame, or displayed TF frames change
  useEffect(() => {
    if (isRosConnected) {
      const stateToSave = {
        visualizations,
        fixedFrame: fixedFramePreference,
        displayedTfFrames,
        showAllTfFrames,
        ...tfDisplay,
      };
      saveVisualizationStateForKey(storageKey, stateToSave);
      console.log('Saved visualization state:', stateToSave);
    }
  }, [visualizations, fixedFramePreference, displayedTfFrames, showAllTfFrames, tfDisplay, isRosConnected, storageKey]);

  // The provider resolves the preference against the live TF tree; `fixedFrame` is the frame the
  // scene is actually anchored to.
  const {
    customTFProvider,
    isProviderReady,
    transforms,
    availableFrames,
    fixedFrame,
  } = useTfProvider({
    ros,
    isRosConnected,
    ros3dViewer, // Pass viewer ref from the other hook
    viewerGeneration,
    fixedFrame: fixedFramePreference,
    trackTransformUpdates: showAllTfFrames || displayedTfFrames.length > 0,
  });

  // "Show all" follows the live tree so frames that appear later are added automatically.
  const visibleTfFrames = showAllTfFrames ? availableFrames : displayedTfFrames;

  // Visualizer adapters render no UI of their own. Mount them only after both mutable refs are
  // ready so a restored panel cannot permanently miss setup during a delayed 0x0 viewer mount.
  const visualizersReady = isRosConnected
    && viewerGeneration > 0
    && ros3dViewer.current !== null
    && isProviderReady;

  // REMOVED Direct PointCloud Client Hook Call
  // usePointCloudClient({ ... });

  // TF Visualizer Hook Call (Still direct)
  useTfVisualizer({
    isRosConnected: visualizersReady,
    ros3dViewer,
    customTFProvider,
    fixedFrame,
    displayedTfFrames: visibleTfFrames,
    transforms,
    showAxes: tfDisplay.showTfAxes,
    showFrameLabels: tfDisplay.showTfFrameLabels,
    showConnections: tfDisplay.showTfConnections,
    axesScale: tfDisplay.tfAxesScale,
    labelScale: tfDisplay.tfLabelScale,
    axesOpacity: tfDisplay.tfAxesOpacity,
    labelOpacity: tfDisplay.tfLabelOpacity,
    showLabelBackground: tfDisplay.showTfLabelBackground,
  });

  // REMOVED Direct CameraInfo Visualizer Hook Call
  // useCameraInfoVisualizer({ ... });

  // --- Add/Remove Visualization Logic ---
  const addVisualization = (config: Omit<VisualizationConfig, 'id'>) => {
    const newViz: VisualizationConfig = { ...config, id: uuidv4() };
    setVisualizations((prev: VisualizationConfig[]) => [...prev, newViz]);
    setIsAddVizModalOpen(false); // Close modal after adding
    setIsSettingsPopupOpen(true); // Reopen settings popup
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
  const closeSettingsPopup = () => setIsSettingsPopupOpen(false);

  // Handler to open Add Viz Modal from Settings (close Settings, open Add)
  const openAddVizModalFromSettings = () => {
    setIsSettingsPopupOpen(false);
    setIsAddVizModalOpen(true);
  };

  // Handler to close Add Viz Modal and return to Settings
  const closeAddVizModalAndReturnToSettings = () => {
    setIsAddVizModalOpen(false);
    setIsSettingsPopupOpen(true);
  };

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

  // useTfProvider pushes the resolved frame into the provider and viewer, so the preference is
  // the only thing to update here.
  const handleFixedFrameChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFixedFramePreference(event.target.value);
  };

  const handleDisplayedTfFramesChange = (selectedFrames: string[]) => {
    // Editing individual frames while "all" is on means the user wants a subset again.
    setShowAllTfFrames(false);
    setDisplayedTfFrames(selectedFrames);
  };

  // The toggle is a quick "everything / nothing" switch; individual picks start from a clean list.
  const handleShowAllTfFramesChange = (showAll: boolean) => {
    setShowAllTfFrames(showAll);
    if (!showAll) setDisplayedTfFrames([]);
  };

  // Visualization-specific editors still use their legacy popovers. The shared
  // panel menu and add-visualization sheet handle their own outside clicks.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const pcSettingsElement = panelRef.current?.querySelector('.point-cloud-settings-popup');
      if (activeSettingsVizId && pcSettingsElement && !pcSettingsElement.contains(event.target as Node)) {
        setActiveSettingsVizId(null);
      }
    };
    if (activeSettingsVizId !== null) {
      const timerId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return () => { };
  }, [activeSettingsVizId]);

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
    <div className="visualization-panel" ref={panelRef}>
      {/* Render Visualization Wrapper Components */}
      {visualizersReady && visualizations.map((viz: VisualizationConfig) => {
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
                dependenciesReady={isProviderReady}
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
      <div ref={viewerRef} className="viewer-container" id={viewerIdRef.current}></div>

      <TreePanelMenu
        open={isSettingsPopupOpen}
        onOpen={() => setIsSettingsPopupOpen(true)}
        onClose={closeSettingsPopup}
        triggerBarClassName="visualization-float-bar"
        triggerContent={<span className="visualization-menu-title">3D View</span>}
        buttonLabel="Settings"
        buttonTitle="3D view settings"
        panelTestId="visualization-settings-panel"
        panelLabel="3D view settings"
        classNames={{ panel: 'visualization-menu-panel' }}
        menuContent={
          <SettingsPopup
            onClose={closeSettingsPopup}
            fixedFrame={fixedFrame}
            availableFrames={availableFrames}
            displayedTfFrames={visibleTfFrames}
            showAllTfFrames={showAllTfFrames}
            onShowAllTfFramesChange={handleShowAllTfFramesChange}
            tfDisplay={tfDisplay}
            onTfDisplayChange={updateTfDisplay}
            onFixedFrameChange={handleFixedFrameChange}
            onDisplayedTfFramesChange={handleDisplayedTfFramesChange}
            activeVisualizations={visualizations}
            onRemoveVisualization={removeVisualization}
            onAddVisualizationClick={openAddVizModalFromSettings}
            onEditVisualization={openVisualizationSettings}
            onUpdateVisualizationTopic={updateVisualizationTopic}
            allTopics={allTopics}
          />
        }
      />

      {/* Add Visualization Modal */}
      {isAddVizModalOpen && (
        <AddVisualizationModal
          isOpen={isAddVizModalOpen} // Pass state down
          allTopics={allTopics}
          onAddVisualization={addVisualization}
          onClose={closeAddVizModalAndReturnToSettings} // Return to Settings after closing
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
