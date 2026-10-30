import React, { useCallback, useEffect, useRef, useState, memo, lazy, Suspense } from 'react';
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
import type { PointCloudSettingsOptions } from './visualizers/PointCloudSettings';
import type { LaserScanSettingsOptions } from './visualizers/LaserScanSettings';
import type { PoseStampedSettingsOptions } from './visualizers/PoseStampedSettings';
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
import { pointCloudSource } from '../utils/pointCloudSource';
const CameraInfoViz = lazy(() => import('./visualizers/CameraInfoViz'));
import MarkerArrayViz from './visualizers/MarkerArrayViz';
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
import { getTopicsForVisualizationType, isTopicVisualizationType, TOPIC_VISUALIZATION_TYPES, type TopicVisualizationType } from '../utils/visualizationTopics';
import { getPreferredUrdfTopic } from '../utils/urdfTopics';
import type { MeshDisplayOptions } from '../utils/meshOpacity';
import type { NavigationDisplayOptions } from '../utils/navigationOptions';
import NavigationViz from './visualizers/NavigationViz';
const CameraImageViz = lazy(() => import('./visualizers/CameraImageViz'));
import { DEFAULT_NEW_CAMERA_IMAGE_OPTIONS, cameraInfoTopicFor, type CameraImageOptions } from '../utils/images/cameraImageOptions';
import { jointDescriptionTopic, type JointStateOptions } from '../utils/jointStates';
import type { PanelSettingsBridge } from '../features/assistant/types';
import type { WorkspaceOpenRequest } from './workspaceOpenRequest';
import type { CameraImageClient } from '../utils/ros3d/visualizers/CameraImage';
import { bindCameraPicking, type CameraPickObject } from '../utils/images/cameraInteraction';
const CameraInspector = lazy(() => import('./visualizers/CameraInspector'));

// Load optional telemetry only when selected; keep the workspace chunk within the PWA precache limit.
const JointStateOverlay = lazy(() => import('./visualizers/JointStateOverlay'));

interface VisualizationPanelProps {
  ros: Ros | null; // Allow null ros object
  storageKey?: string;
  /** Workspace panel id, used to register the assistant settings bridge. */
  panelId?: string;
  onRegisterAssistantBridge?: (panelId: string, bridge: PanelSettingsBridge | null) => void;
  onOpen?: (request: WorkspaceOpenRequest) => void;
}

// Define the structure for a visualization configuration
export interface VisualizationConfig {
  id: string;
  type: TopicVisualizationType | 'tf';
  topic: string; // For pointcloud/camerainfo/laserscan/posestamped. For URDF, this might be robot_description topic
  options?: JointStateOptions | CameraImageOptions | NavigationDisplayOptions | MeshDisplayOptions | PointCloudOptions | CameraInfoOptions | UrdfOptions | LaserScanOptions | LaserScanSettingsOptions | PoseStampedOptions | PoseStampedSettingsOptions; // Union of option types
}

// Define more specific option types
export interface PointCloudOptions extends PointCloudSettingsOptions { }
export interface CameraInfoOptions {
  lineColor?: THREE.Color | number | string;
  lineScale?: number;
}
export interface UrdfOptions extends MeshDisplayOptions {
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

const VALID_VISUALIZATION_TYPES: VisualizationConfig['type'][] = [...TOPIC_VISUALIZATION_TYPES, 'tf'];

const DEFAULT_STORAGE_KEY = 'roboboy_3d_visualization_state';

const TF_DISPLAY_KEYS: ReadonlyArray<keyof TfDisplaySettings> = [
  'showTfAxes', 'showTfFrameLabels', 'showTfConnections', 'tfAxesScale', 'tfAxesWidth', 'tfLabelScale', 'tfAxesOpacity', 'tfLabelOpacity', 'showTfLabelBackground',
];

const ASSISTANT_SETTINGS_HELP =
  'Keys: "fixedFrame" (a frame name from availableFrames); "showAllTfFrames" (boolean); "showTfFrames" / "hideTfFrames" (arrays of frame names to add to or remove from the displayed list); ' +
  '"tfDisplay" (object with any of showTfAxes, showTfFrameLabels, showTfConnections, showTfLabelBackground as booleans and tfAxesScale (length), tfAxesWidth (diameter), tfLabelScale in metres, tfAxesOpacity, tfLabelOpacity from 0 to 1); ' +
  '"addVisualizations" (array of {"type": one of pointcloud|camerainfo|urdf|laserscan|posestamped|markerarray|path|occupancygrid|cameraimage|jointstate, "topic": optional — the first compatible topic is used when omitted}); ' +
  '"removeVisualizations" (array of {"id"} or {"type"} or {"topic"} matching entries in visualizations).';

const VisualizationPanel: React.FC<VisualizationPanelProps> = memo(({
  ros,
  storageKey = DEFAULT_STORAGE_KEY,
  panelId,
  onRegisterAssistantBridge,
  onOpen,
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
  const cameraClients = useRef(new Map<string, CameraImageClient>());
  const cameraPickObjects = useRef(new Map<string, CameraPickObject>());
  const [cameraSelection, setCameraSelection] = useState<string | null>(null);
  const [, setCameraClientVersion] = useState(0);
  const registerCamera = useCallback((id: string, client: CameraImageClient | null) => {
    if (client) { cameraClients.current.set(id, client); cameraPickObjects.current.set(id, client); }
    else { cameraClients.current.delete(id); cameraPickObjects.current.delete(id); }
    setCameraClientVersion(version => version + 1);
  }, []);
  const registerCameraInfo = useCallback((id: string, object: THREE.Group | null, frustum?: THREE.LineSegments) => {
    if (object && frustum) cameraPickObjects.current.set(id, { object, frustum }); else cameraPickObjects.current.delete(id);
  }, []);
  useEffect(() => {
    if (ros3dViewer.current) return bindCameraPicking(ros3dViewer.current, cameraPickObjects.current, setCameraSelection);
  }, [ros3dViewer, viewerGeneration]);

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

  // State for modular visualizations
  const [visualizations, setVisualizations] = useState<VisualizationConfig[]>(initialState.visualizations);
  const [allTopics, setAllTopics] = useState<TopicInfo[]>([]); // Store all topics
  const [visualizationStatus, setVisualizationStatus] = useState<Record<string, string | null>>({});
  const reportVisualizationStatus = useCallback((id: string, status: string | null) => {
    setVisualizationStatus(previous => previous[id] === status ? previous : { ...previous, [id]: status });
  }, []);

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
    axesWidth: tfDisplay.tfAxesWidth,
    labelScale: tfDisplay.tfLabelScale,
    axesOpacity: tfDisplay.tfAxesOpacity,
    labelOpacity: tfDisplay.tfLabelOpacity,
    showLabelBackground: tfDisplay.showTfLabelBackground,
  });

  // REMOVED Direct CameraInfo Visualizer Hook Call
  // useCameraInfoVisualizer({ ... });

  // --- Add/Remove Visualization Logic ---
  const addVisualization = (config: Omit<VisualizationConfig, 'id'>) => {
    const newViz: VisualizationConfig = { ...config, id: uuidv4(), options: { ...(config.type === 'cameraimage' ? DEFAULT_NEW_CAMERA_IMAGE_OPTIONS : {}), ...config.options } };
    setVisualizations((prev: VisualizationConfig[]) => [...prev, newViz]);
    setIsAddVizModalOpen(false); // Close modal after adding
    setIsSettingsPopupOpen(true); // Reopen settings popup
    console.log("Added visualization:", newViz);
  };

  const removeVisualization = (idToRemove: string) => {
    setVisualizationStatus(previous => { const next = { ...previous }; delete next[idToRemove]; return next; });
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
            if (expectsBoolean ? typeof value === 'boolean' : typeof value === 'number' && Number.isFinite(value) && value > 0
              && (key !== 'tfAxesWidth' || (value >= 0.001 && value <= 0.1))) {
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
              options: type === 'urdf' ? ({ robotDescriptionTopic: topic } as UrdfOptions) : type === 'cameraimage' ? { ...DEFAULT_NEW_CAMERA_IMAGE_OPTIONS } : {},
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

  // console.log(`--- VisualizationPanel Render End ---`);

  return (
    <div className="visualization-panel" ref={panelRef}>
      {/* Render Visualization Wrapper Components */}
      {visualizersReady && visualizations.map((viz: VisualizationConfig) => {
        if (viz.type === 'pointcloud') {
          const source = pointCloudSource(viz.topic, allTopics);
          return (
            <React.Fragment key={viz.id}>
              <PointCloudViz
                ros={ros}
                visualizationId={viz.id}
                onStatus={reportVisualizationStatus}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                topic={source.topic}
                messageType={source.messageType}
                fixedFrame={fixedFrame}
                options={viz.options as PointCloudOptions}
              />
            </React.Fragment>
          );
        } else if (viz.type === 'camerainfo') {
          return (
            <Suspense key={viz.id} fallback={null}>
            <CameraInfoViz
              id={viz.id} onObject={registerCameraInfo}
              key={viz.id}
              ros={ros}
              isRosConnected={isRosConnected && isProviderReady}
              ros3dViewer={ros3dViewer}
              customTFProvider={customTFProvider}
              topic={viz.topic}
              options={viz.options as CameraInfoOptions}
            />
            </Suspense>
          );
        } else if (viz.type === 'markerarray') {
          return <MarkerArrayViz key={viz.id} layerId={viz.id} ros={ros} topic={viz.topic} viewer={ros3dViewer}
            provider={customTFProvider} ready={isProviderReady} opacity={(viz.options as MeshDisplayOptions)?.opacity} />;
        } else if (viz.type === 'urdf') { // Added URDF rendering
          return (
            <React.Fragment key={viz.id}>
              <UrdfViz
                layerId={viz.id}
                ros={ros}
                isRosConnected={isRosConnected}
                ros3dViewer={ros3dViewer}
                customTFProvider={customTFProvider}
                dependenciesReady={isProviderReady}
                robotDescriptionTopic={(viz.options as UrdfOptions)?.robotDescriptionTopic || viz.topic}
                urdfPath={(viz.options as UrdfOptions)?.urdfPath}
                opacity={(viz.options as UrdfOptions)?.opacity}
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
                visualizationId={viz.id}
                onStatus={reportVisualizationStatus}
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
        } else if (viz.type === 'cameraimage' && ros) {
          const options = viz.options as CameraImageOptions | undefined;
          return <Suspense key={viz.id} fallback={null}><CameraImageViz id={viz.id} ros={ros} viewer={ros3dViewer} provider={customTFProvider}
            ready={isProviderReady} onClient={registerCamera}
            topic={viz.topic} messageType={allTopics.find(item => item.name === viz.topic)?.type
              ?? (viz.topic.endsWith('/compressed') ? 'sensor_msgs/CompressedImage' : 'sensor_msgs/Image')}
            options={{ ...options, cameraInfoTopic: options?.cameraInfoTopic ?? cameraInfoTopicFor(viz.topic, allTopics) }} onStatus={reportVisualizationStatus} /></Suspense>;
        } else if (viz.type === 'path' || viz.type === 'occupancygrid') {
          return <NavigationViz key={viz.id} id={viz.id} type={viz.type} topic={viz.topic}
            ros={ros} connected={isRosConnected} viewer={ros3dViewer} provider={customTFProvider}
            ready={isProviderReady} options={viz.options as NavigationDisplayOptions} onStatus={reportVisualizationStatus} />;
        } else if (viz.type === 'tf') {
          // TF visualization is handled globally by the useTfVisualizer hook,
          // so we don't need to render a specific component here.
          // We keep this entry in the `visualizations` state to represent
          // that the user has chosen to display TFs.
          return null;
        }
        return null;
      })}

      <Suspense fallback={null}>
        {visualizations.filter(viz => viz.type === 'jointstate').map(viz => (
          <JointStateOverlay key={viz.id} id={viz.id} ros={isRosConnected ? ros : null} topic={viz.topic}
            messageType={allTopics.find(item => item.name === viz.topic)?.type ?? 'sensor_msgs/JointState'}
            options={viz.options as JointStateOptions} container={panelRef}
            descriptionTopic={(viz.options as JointStateOptions)?.robotDescriptionTopic ?? jointDescriptionTopic(viz.topic, allTopics)}
            onChange={updateVisualizationSettings} onStatus={reportVisualizationStatus} />
        ))}
      </Suspense>

      {/* Main Viewer Div */}
      <div ref={viewerRef} className="viewer-container" id={viewerIdRef.current}></div>
      <Suspense fallback={null}>
        {visualizations.filter(viz => viz.id === cameraSelection && (viz.type === 'cameraimage' || viz.type === 'camerainfo')).map(viz =>
          <CameraInspector key={viz.id} client={cameraClients.current.get(viz.id)} viewer={ros3dViewer.current} ros={ros}
            calibrationTopic={viz.type === 'camerainfo' ? viz.topic : undefined}
            imageTopics={allTopics.filter(item => /\/(?:CompressedImage|Image)$/.test(item.type))}
            topic={viz.type === 'camerainfo' ? '' : viz.topic} options={{ ...viz.options as CameraImageOptions,
              cameraInfoTopic: (viz.options as CameraImageOptions)?.cameraInfoTopic ?? cameraInfoTopicFor(viz.topic, allTopics) }}
            status={visualizationStatus[viz.id]} onChange={patch => updateVisualizationSettings(viz.id, patch)}
            onClose={() => { setCameraSelection(null); panelRef.current?.querySelector<HTMLButtonElement>('.tree-panel-menu-button')?.focus(); }} onOpen={onOpen} />)}
      </Suspense>

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
            onInspectCamera={id => { setCameraSelection(id); setIsSettingsPopupOpen(false); }}
            visualizationStatus={visualizationStatus}
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
            onUpdateVisualizationTopic={updateVisualizationTopic}
            onUpdateVisualizationOptions={updateVisualizationSettings}
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

      {/* Display Errors */}
      {fetchTopicsError && <div className="error-display">{fetchTopicsError}</div>}
    </div>
  );
});

export default VisualizationPanel;
