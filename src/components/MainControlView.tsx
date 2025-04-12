import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ConnectionParams } from '../App'; // Import types
import { useRos } from '../hooks/useRos'; // Import the hook
import './MainControlView.css';
// Import placeholder components (we'll create these next)
import CameraView from './CameraView'; // Import the new CameraView
import VisualizationPanel from './VisualizationPanel'; // Import the new VisualizationPanel
import ControlPanel from './ControlPanel'; // We will create this next
import StandardPadLayout from './gamepads/standard/StandardPadLayout'; // Import the new StandardPad layout
import VoiceLayout from './gamepads/voice/VoiceLayout'; // Import the new Voice layout
import GameBoyLayout from './gamepads/gameboy/GameBoyLayout'; // Import the new GameBoy layout
import { generateUniqueId } from '../utils/helpers'; // Assuming a helper exists
import ControlPanelTabs from './ControlPanelTabs'; // Import the new tabs component
import AddPanelMenu from './AddPanelMenu'; // Import the AddPanelMenu component

// --- Top Bar Icons ---
const IconMCVCamera = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);
const IconMCV3d = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);
const IconMCVLink = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const IconMCVUnlink = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);
const IconMCVClose = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
// --- End Top Bar Icons ---

// Use Icon components
const icons = {
  camera: <IconMCVCamera />,
  view3d: <IconMCV3d />,
  connected: <IconMCVLink />,
  disconnected: <IconMCVUnlink />,
  disconnect: <IconMCVClose />,
};

// Define Panel Types
export type PanelType = 'standardpad' | 'voicelayout' | 'gameboy'; // Updated types
export interface ActivePanel {
  id: string;
  type: PanelType;
  name: string; // Display name for the tab
}

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

  // --- New State for Modular Control Panels ---
  const initialPanelId = generateUniqueId('panel');
  const [activePanels, setActivePanels] = useState<ActivePanel[]>([
    { id: initialPanelId, type: 'standardpad', name: 'Pad 1' } // Start with standard pad
  ]);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(initialPanelId);
  const [isAddPanelMenuOpen, setIsAddPanelMenuOpen] = useState(false);
  // Counter for naming new panels of the same type
  const panelCounters = useRef<Record<PanelType, number>>({ standardpad: 1, voicelayout: 0, gameboy: 0 }); // Updated counters
  // Ref for the Add Panel button (+) 
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // --- End New State ---

  // Ref to prevent multiple connection attempts
  const isConnecting = useRef(false);

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

  // --- Handlers for Modular Panels ---
  const handleSelectPanel = (id: string) => {
    setSelectedPanelId(id);
    setIsAddPanelMenuOpen(false); // Close menu when selecting existing panel
  };

  const handleAddPanelToggle = () => {
    setIsAddPanelMenuOpen(prev => !prev);
  };

  const handleAddPanelType = (type: PanelType) => {
    // Define labels based on the new types
    const typeLabels: Record<PanelType, string> = {
        standardpad: 'Pad',
        voicelayout: 'Voice',
        gameboy: 'GameBoy'
    };
    panelCounters.current[type]++;
    const newName = `${typeLabels[type]} ${panelCounters.current[type]}`; // Use label for name
    const newPanel: ActivePanel = {
        id: generateUniqueId('panel'),
        type: type,
        name: newName,
    };
    setActivePanels(prev => [...prev, newPanel]);
    setSelectedPanelId(newPanel.id); // Select the newly added panel
    setIsAddPanelMenuOpen(false); // Close the menu
  };

  const handleRemovePanel = (idToRemove: string) => {
    setActivePanels(prev => {
      const newPanels = prev.filter(panel => panel.id !== idToRemove);
      // If the removed panel was selected, select the first remaining panel or null
      if (selectedPanelId === idToRemove) {
        setSelectedPanelId(newPanels.length > 0 ? newPanels[0].id : null);
      }
      return newPanels;
    });
    setIsAddPanelMenuOpen(false); // Close menu if open
  };

  const handleCloseMenu = () => {
    setIsAddPanelMenuOpen(false);
  };
  // --- End Panel Handlers ---

  // Memoize the selected panel component to prevent unnecessary re-renders
  const SelectedPanelComponent = useMemo(() => {
    if (!selectedPanelId) return null;
    const panel = activePanels.find(p => p.id === selectedPanelId);
    if (!panel || !ros) return null; // Need ROS connection for panels

    switch (panel.type) {
      case 'standardpad':
        return <StandardPadLayout ros={ros} key={panel.id} />;
      case 'voicelayout':
        return <VoiceLayout ros={ros} key={panel.id} />;
      case 'gameboy':
        return <GameBoyLayout ros={ros} key={panel.id} />;
      default:
        return <div>Unknown Panel Type</div>;
    }
  }, [selectedPanelId, activePanels, ros]);

  return (
    <div className="main-control-view">
      {/* Unified Top Bar */}
      <div className="top-bar">
        <div className="view-toggle">
          <button 
            onClick={() => setViewMode('camera')} 
            className={viewMode === 'camera' ? 'active' : ''}
            title="Camera View"
            aria-label="Switch to Camera View"
          >
            {icons.camera}
          </button>
          <button 
            onClick={() => setViewMode('3d')} 
            className={viewMode === '3d' ? 'active' : ''}
            title="3D View"
            aria-label="Switch to 3D View"
          >
            {icons.view3d}
          </button>
        </div>
        <div className="status-controls">
          <div 
            className={`connection-status-icon ${isConnected ? 'connected' : 'disconnected'}`}
            title={isConnected ? 'Status: Connected' : 'Status: Disconnected'}
            aria-label={isConnected ? 'Status: Connected' : 'Status: Disconnected'}
            role="status"
          >
            {isConnected ? icons.connected : icons.disconnected}
          </div>
          <button 
            onClick={handleInternalDisconnect} 
            className="disconnect-button-icon"
            title="Disconnect"
            aria-label="Disconnect"
          >
            {icons.disconnect}
          </button>
        </div>
      </div>

      {/* Main Content Area - ensure it starts below the top bar */}
      <div className="main-content-area">
        <div className="view-panel-container">
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
           <ControlPanelTabs 
               panels={activePanels}
               selectedPanelId={selectedPanelId}
               onSelectPanel={handleSelectPanel}
               onAddPanelToggle={handleAddPanelToggle}
               onRemovePanel={handleRemovePanel}
               addButtonRef={addButtonRef}
           /> 
           <div className="control-panel card">
               {/* Render the selected panel component */}
               {isConnected && ros ? (
                   SelectedPanelComponent ?? <div>Select a control panel</div>
               ) : (
                   <div>Connecting to ROS...</div>
               )}
           </div>
        </div>
      </div>

      {/* Render AddPanelMenu using Portal outside main flow */}
      <AddPanelMenu
        isOpen={isAddPanelMenuOpen}
        onSelectType={handleAddPanelType}
        onClose={handleCloseMenu}
        addButtonRef={addButtonRef}
      />
    </div>
  );
};

export default MainControlView; 