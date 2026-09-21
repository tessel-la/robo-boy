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
import { getTopicsForVisualizationType, isTopicVisualizationType, TOPIC_VISUALIZATION_TYPES } from '../utils/visualizationTopics';
import { getPreferredUrdfTopic } from '../utils/urdfTopics';
import type { PanelSettingsBridge } from '../features/assistant/types';

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
  storageKey?: string;
  /** Workspace panel id, used to register the assistant settings bridge. */
  panelId?: string;
  onRegisterAssistantBridge?: (panelId: string, bridge: PanelSettingsBridge | null) => void;
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

const TF_DISPLAY_KEYS: ReadonlyArray<keyof TfDisplaySettings> = [
  'showTfAxes', 'showTfFrameLabels', 'showTfConnections', 'tfAxesScale', 'tfLabelScale', 'tfAxesOpacity', 'tfLabelOpacity', 'showTfLabelBackground',
];

const ASSISTANT_SETTINGS_HELP =
  'Keys: "fixedFrame" (a frame name from availableFrames); "showAllTfFrames" (boolean); "showTfFrames" / "hideTfFrames" (arrays of frame names to add to or remove from the displayed list); ' +
  '"tfDisplay" (object with any of showTfAxes, showTfFrameLabels, showTfConnections, showTfLabelBackground as booleans and tfAxesScale, tfLabelScale in metres, tfAxesOpacity, tfLabelOpacity from 0 to 1); ' +
  '"addVisualizations" (array of {"type": one of pointcloud|camerainfo|urdf|laserscan|posestamped, "topic": optional — the first compatible topic is used when omitted}); ' +
  '"removeVisualizations" (array of {"id"} or {"type"} or {"topic"} matching entries in visualizations).';

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({
  ros,
  storageKey = DEFAULT_STORAGE_KEY,
  panelId,
  onRegisterAssistantBridge,
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

  // --- Assistant settings bridge: what the panel shows, and the same changes the menu makes.
  // Registered once; the latest state and handlers are read through a ref so the bridge never
  // acts on a stale render.
  const assistantStateRef = useRef({
    fixedFrame, availableFrames, visibleTfFrames, showAllTfFrames, tfDisplay, visualizations, allTopics,
    setFixedFramePreference, handleDisplayedTfFramesChange, handleShowAllTfFramesChange, updateTfDisplay, setVisualizations,
  });
  assistantStateRef.current = {
    fixedFrame, availableFrames, visibleTfFrames, showAllTfFrames, tfDisplay, visualizations, allTopics,
    setFixedFramePreference, handleDisplayedTfFramesChange, handleShowAllTfFramesChange, updateTfDisplay, setVisualizations,
  };
  useEffect(() => {
    if (!panelId || !onRegisterAssistantBridge) return;
    const bridge: PanelSettingsBridge = {
      panelType: '3d',
      settingsHelp: ASSISTANT_SETTINGS_HELP,
      describe: () => {
        const current = assistantStateRef.current;
        return {
          fixedFrame: current.fixedFrame,
          availableFrames: current.availableFrames,
          displayedTfFrames: current.visibleTfFrames,
          showAllTfFrames: current.showAllTfFrames,
          tfDisplay: current.tfDisplay,
          visualizations: current.visualizations.map(viz => ({ id: viz.id, type: viz.type, topic: viz.topic })),
          availableVisualizationTopics: Object.fromEntries(
            TOPIC_VISUALIZATION_TYPES.map(type => [type, getTopicsForVisualizationType(type, current.allTopics).map(topic => topic.name)])
          ),
        };
      },
      apply: settings => {
        const current = assistantStateRef.current;
        const outcomes: Array<{ ok: boolean; message: string }> = [];
        const asStringArray = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

        if (typeof settings.fixedFrame === 'string') {
          const frame = settings.fixedFrame.replace(/^\//, '');
          if (current.availableFrames.includes(frame)) {
            current.setFixedFramePreference(frame);
            outcomes.push({ ok: true, message: `Fixed frame set to ${frame}.` });
          } else {
            outcomes.push({ ok: false, message: `No TF frame "${frame}" (available: ${current.availableFrames.join(', ') || 'none yet'}).` });
          }
        }
        if (typeof settings.showAllTfFrames === 'boolean') {
          current.handleShowAllTfFramesChange(settings.showAllTfFrames);
          outcomes.push({ ok: true, message: settings.showAllTfFrames ? 'Showing every TF frame.' : 'Hid all TF frames.' });
        }
        let frames = settings.showAllTfFrames === true ? current.availableFrames : settings.showAllTfFrames === false ? [] : current.visibleTfFrames;
        const toShow = asStringArray(settings.showTfFrames).map(frame => frame.replace(/^\//, ''));
        const toHide = new Set(asStringArray(settings.hideTfFrames).map(frame => frame.replace(/^\//, '')));
        if (toShow.length || toHide.size) {
          const unknown = toShow.filter(frame => !current.availableFrames.includes(frame));
          const shown = toShow.filter(frame => current.availableFrames.includes(frame));
          frames = Array.from(new Set([...frames.filter(frame => !toHide.has(frame)), ...shown]));
          current.handleDisplayedTfFramesChange(frames);
          if (shown.length) outcomes.push({ ok: true, message: `Showing ${shown.join(', ')}.` });
          if (toHide.size) outcomes.push({ ok: true, message: `Hid ${[...toHide].join(', ')}.` });
          if (unknown.length) outcomes.push({ ok: false, message: `No TF frame named ${unknown.join(', ')}.` });
        }
        if (settings.tfDisplay && typeof settings.tfDisplay === 'object') {
          const patch: Partial<TfDisplaySettings> = {};
          const rejected: string[] = [];
          Object.entries(settings.tfDisplay as Record<string, unknown>).forEach(([key, value]) => {
            if (!TF_DISPLAY_KEYS.includes(key as keyof TfDisplaySettings)) return rejected.push(key);
            const expectsBoolean = key.startsWith('show');
            if (expectsBoolean ? typeof value === 'boolean' : typeof value === 'number' && Number.isFinite(value) && value > 0) {
              (patch as Record<string, unknown>)[key] = value;
            } else {
              rejected.push(key);
            }
          });
          if (Object.keys(patch).length) {
            current.updateTfDisplay(patch);
            outcomes.push({ ok: true, message: `Frame display updated (${Object.keys(patch).join(', ')}).` });
          }
          if (rejected.length) outcomes.push({ ok: false, message: `Ignored unknown or invalid frame display keys: ${rejected.join(', ')}.` });
        }
        if (Array.isArray(settings.addVisualizations)) {
          settings.addVisualizations.forEach(entry => {
            const type = (entry as { type?: unknown })?.type;
            const requestedTopic = (entry as { topic?: unknown })?.topic;
            if (!isTopicVisualizationType(type)) {
              outcomes.push({ ok: false, message: `Unknown visualization type "${String(type)}".` });
              return;
            }
            const candidates = getTopicsForVisualizationType(type, current.allTopics);
            const topic = typeof requestedTopic === 'string'
              ? candidates.find(candidate => candidate.name === requestedTopic)?.name
              : (type === 'urdf' ? getPreferredUrdfTopic(candidates)?.name : candidates[0]?.name);
            if (!topic) {
              outcomes.push({ ok: false, message: typeof requestedTopic === 'string' ? `"${requestedTopic}" is not a ${type} topic on this robot.` : `No topic on this robot can feed a ${type} visualization.` });
              return;
            }
            if (current.visualizations.some(viz => viz.type === type && viz.topic === topic)) {
              outcomes.push({ ok: true, message: `${type} on ${topic} is already shown.` });
              return;
            }
            const newViz: VisualizationConfig = {
              id: uuidv4(), type, topic,
              options: type === 'urdf' ? ({ robotDescriptionTopic: topic } as UrdfOptions) : {},
            };
            current.setVisualizations(prev => [...prev, newViz]);
            current.visualizations = [...current.visualizations, newViz];
            outcomes.push({ ok: true, message: `Added ${type} on ${topic}.` });
          });
        }
        if (Array.isArray(settings.removeVisualizations)) {
          settings.removeVisualizations.forEach(entry => {
            const match = (entry ?? {}) as { id?: unknown; type?: unknown; topic?: unknown };
            const targets = current.visualizations.filter(viz =>
              (typeof match.id === 'string' && viz.id === match.id) ||
              (typeof match.type === 'string' && viz.type === match.type && (typeof match.topic !== 'string' || viz.topic === match.topic)) ||
              (typeof match.id !== 'string' && typeof match.type !== 'string' && typeof match.topic === 'string' && viz.topic === match.topic)
            );
            if (targets.length === 0) {
              outcomes.push({ ok: false, message: `No visualization matches ${JSON.stringify(match)}.` });
              return;
            }
            const ids = new Set(targets.map(viz => viz.id));
            current.setVisualizations(prev => prev.filter(viz => !ids.has(viz.id)));
            current.visualizations = current.visualizations.filter(viz => !ids.has(viz.id));
            outcomes.push({ ok: true, message: `Removed ${targets.map(viz => `${viz.type} on ${viz.topic}`).join(', ')}.` });
          });
        }
        if (outcomes.length === 0) outcomes.push({ ok: false, message: `Nothing in those settings applies to the 3D view. ${ASSISTANT_SETTINGS_HELP}` });
        return outcomes;
      },
    };
    onRegisterAssistantBridge(panelId, bridge);
    return () => onRegisterAssistantBridge(panelId, null);
  }, [panelId, onRegisterAssistantBridge]);

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
