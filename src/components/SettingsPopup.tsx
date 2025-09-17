import React, { useRef, useEffect, useState } from 'react';
import { FiX, FiChevronDown, FiChevronRight, FiTrash2, FiPlus, FiSettings } from 'react-icons/fi';
import './VisualizationPanel.css'; // Reuse styles for now
import { VisualizationConfig } from './VisualizationPanel'; // Import shared config type

// Define structure for storing fetched topics
interface TopicInfo {
  name: string;
  type: string;
}

// Updated props interface
interface SettingsPopupProps {
  onClose: () => void;
  fixedFrame: string;
  availableFrames: string[];
  onFixedFrameChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  displayedTfFrames: string[];
  onDisplayedTfFramesChange: (selectedFrames: string[]) => void;
  activeVisualizations: VisualizationConfig[];
  onRemoveVisualization: (id: string) => void;
  onAddVisualizationClick: () => void; // Prop to open the Add modal
  onEditVisualization?: (id: string) => void; // New prop for editing visualizations
  onUpdateVisualizationTopic?: (id: string, newTopic: string) => void; // New prop for changing topics
  allTopics: TopicInfo[]; // Add allTopics to get available topics for type
  tfAxesScale: number; // Add TF axes scale prop
  onTfAxesScaleChange: (newScale: number) => void; // Add TF axes scale change handler
}

// Type for section visibility state
interface SectionVisibility {
  tfFrames: boolean;
  activeViz: boolean;
}

// Map to store which visualization item is showing a topic dropdown
interface TopicEditState {
  [vizId: string]: boolean;
}

// Explicitly type the props object here, then destructure
const SettingsPopup = (props: SettingsPopupProps) => {
  const {
    onClose,
    fixedFrame,
    availableFrames,
    onFixedFrameChange,
    displayedTfFrames,
    onDisplayedTfFramesChange,
    // New props
    activeVisualizations,
    onRemoveVisualization,
    onAddVisualizationClick,
    onEditVisualization,
    onUpdateVisualizationTopic,
    allTopics = [], // Default to empty array if not provided
    tfAxesScale, // Add TF axes scale prop
    onTfAxesScaleChange, // Add TF axes scale change handler
  } = props;

  const popupRef = useRef<HTMLDivElement>(null);

  // State for collapsible sections
  const [openSections, setOpenSections] = useState<SectionVisibility>({
      tfFrames: false,  // Default TF closed
      activeViz: true // Default Active Visualizations open
  });

  // State to track which viz items are showing topic dropdown
  const [showingTopicDropdown, setShowingTopicDropdown] = useState<TopicEditState>({});

  const toggleSection = (section: keyof SectionVisibility) => {
      setOpenSections((prev: SectionVisibility) => ({
          ...prev,
          [section]: !prev[section]
      }));
  };

  // Toggle topic dropdown for a visualization
  const toggleTopicDropdown = (vizId: string) => {
    setShowingTopicDropdown(prev => ({
      ...prev,
      [vizId]: !prev[vizId]
    }));
  };

  // Effect to handle clicks outside the popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        // Check if the click target is the toggle button itself to prevent immediate reopening
        const toggleButton = document.getElementById('viz-settings-button'); // Use correct button ID
        if (!toggleButton || !toggleButton.contains(event.target as Node)) {
             onClose();
        }
      }
    };

    // Add event listener
    const timerId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    
    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const handleTfCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const frameName = event.target.value;
      const isChecked = event.target.checked;
      let newSelectedFrames: string[];
      if (isChecked) {
          newSelectedFrames = displayedTfFrames.includes(frameName)
              ? displayedTfFrames
              : [...displayedTfFrames, frameName];
      } else {
          newSelectedFrames = displayedTfFrames.filter(f => f !== frameName);
      }
      onDisplayedTfFramesChange(newSelectedFrames);
  };

  // Handle edit visualization click 
  const handleEditClick = (id: string) => {
    if (onEditVisualization) {
      onEditVisualization(id);
      onClose(); // Close settings popup when opening the specific visualization settings
    }
  };

  // Handle topic change for a visualization
  const handleTopicChange = (vizId: string, event: React.ChangeEvent<HTMLSelectElement>) => {
    const newTopic = event.target.value;
    if (onUpdateVisualizationTopic && newTopic) {
      onUpdateVisualizationTopic(vizId, newTopic);
      // Close the dropdown after selection
      toggleTopicDropdown(vizId);
    }
  };

  // Filter available topics for a specific visualization type
  const getTopicsForVisualizationType = (vizType: string): TopicInfo[] => {
    // Define supported message types for each visualization type
    const typeToMessageTypes: Record<string, string[]> = {
      pointcloud: ['sensor_msgs/PointCloud2', 'sensor_msgs/msg/PointCloud2'],
      camerainfo: ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'],
      urdf: ['std_msgs/String', 'std_msgs/msg/String'], // Add URDF support
      laserscan: ['sensor_msgs/msg/LaserScan'], // Added LaserScan support
      posestamped: ['geometry_msgs/PoseStamped', 'geometry_msgs/msg/PoseStamped'], // Added PoseStamped support
      // Add more mappings as needed
    };

    const supportedTypes = typeToMessageTypes[vizType] || [];
    return allTopics.filter(topic => supportedTypes.includes(topic.type));
  };

  return (
    <div className="settings-popup" ref={popupRef}>
       <div className="settings-popup-header">
         <h3>Settings</h3>
         <button onClick={onClose} className="close-button icon-button" aria-label="Close settings">
           <FiX />
         </button>
       </div>
       
       <div className="settings-popup-content">
         {/* Fixed Frame Selector */}
         <div className="popup-control-item fixed-frame-section">
           <label htmlFor="fixed-frame-select">Fixed Frame:</label>
           <select
             id="fixed-frame-select"
             value={fixedFrame}
             onChange={onFixedFrameChange}
             disabled={availableFrames.length === 0}
           >
             {availableFrames.length > 0 ? (
               availableFrames.map((frame) => (
                 <option key={frame} value={frame}>
                   {frame}
                 </option>
               ))
             ) : (
               <option value="" disabled>No frames available</option>
             )}
           </select>
         </div>

         {/* Displayed TF Frames Selector */}
         <div className="popup-section">
           <button className="section-header" onClick={() => toggleSection('tfFrames')}>
             <h4>Displayed TF Frames</h4>
             {openSections.tfFrames ? <FiChevronDown /> : <FiChevronRight />}
           </button>
           {openSections.tfFrames && (
             <div className="section-content">
               {/* TF Axes Scale Control */}
               <div className="popup-control-item">
                 <label htmlFor="tf-axes-scale" style={{ color: 'var(--text-color)' }}>TF Axes Size:</label>
                 <div className="range-input-container">
                   <input
                     type="range"
                     id="tf-axes-scale"
                     min="0.1"
                     max="2.0"
                     step="0.1"
                     value={tfAxesScale}
                     onChange={(e) => onTfAxesScaleChange(parseFloat(e.target.value))}
                     className="range-input"
                   />
                   <span className="range-value">{tfAxesScale.toFixed(1)}</span>
                 </div>
               </div>
               
               <div className="popup-control-group tf-frame-group">
                 {availableFrames.length > 0 ? (
                   <ul className="tf-checkbox-list">
                     {availableFrames.map((frame) => (
                       <li key={frame}>
                         <label style={{ color: 'var(--text-color)' }}>
                           <input
                             type="checkbox"
                             value={frame}
                             checked={displayedTfFrames.includes(frame)}
                             onChange={handleTfCheckboxChange}
                           />
                           {frame}
                         </label>
                       </li>
                     ))}
                   </ul>
                 ) : (
                   <p className="no-frames-message">No TF frames available.</p>
                 )}
               </div>
             </div>
           )}
         </div>

         {/* --- Active Visualizations Section --- */}
         <div className="popup-section">
           <div className="section-header-with-action">
              <button className="section-header" onClick={() => toggleSection('activeViz')}>
                 <h4>Active Visualizations</h4>
                 {openSections.activeViz ? <FiChevronDown /> : <FiChevronRight />}
               </button>
               <button
                  className="add-viz-popup-button icon-button"
                  onClick={onAddVisualizationClick}
                  title="Add Visualization"
               >
                  <FiPlus />
               </button>
           </div>
           {openSections.activeViz && (
              <div className="section-content active-visualizations-list">
                  {activeVisualizations.length > 0 ? (
                      <ul>
                          {activeVisualizations.map((viz) => (
                              <li key={viz.id} className="visualization-item">
                                  <span className="viz-type">{viz.type.charAt(0).toUpperCase() + viz.type.slice(1)}:</span>
                                  
                                  {/* Always show topic as dropdown to prevent overflow */}
                                  <div className="topic-dropdown-container">
                                    <select
                                      value={viz.topic}
                                      onChange={(e) => handleTopicChange(viz.id, e)}
                                      className="topic-dropdown"
                                      title={viz.topic}
                                    >
                                      {/* Always show current topic even if not in filtered list */}
                                      {!getTopicsForVisualizationType(viz.type).some(t => t.name === viz.topic) && (
                                        <option key={viz.topic} value={viz.topic}>
                                          {viz.topic} (current)
                                        </option>
                                      )}
                                      {getTopicsForVisualizationType(viz.type).length > 0 ? (
                                        getTopicsForVisualizationType(viz.type).map(topic => (
                                          <option key={topic.name} value={topic.name}>
                                            {topic.name}
                                          </option>
                                        ))
                                      ) : (
                                        <option value="" disabled>
                                          No {viz.type} topics available
                                        </option>
                                      )}
                                    </select>
                                  </div>
                                  
                                  {/* Only show settings button for supported viz types */}
                                  {(viz.type === 'pointcloud' || viz.type === 'laserscan' || viz.type === 'posestamped') && onEditVisualization && (
                                    <button
                                      className="viz-settings-button"
                                      onClick={() => handleEditClick(viz.id)}
                                      title={`Configure ${viz.type} visualization`}
                                      aria-label={`Edit ${viz.type} visualization for topic ${viz.topic}`}
                                    >
                                      <FiSettings />
                                    </button>
                                  )}
                                  <button
                                      className="remove-viz-button icon-button"
                                      onClick={() => onRemoveVisualization(viz.id)}
                                      title="Remove Visualization"
                                      aria-label={`Remove ${viz.type} visualization for topic ${viz.topic}`}
                                  >
                                      <FiTrash2 />
                                  </button>
                              </li>
                          ))}
                      </ul>
                  ) : (
                      <p className="no-visualizations-message">No active visualizations.</p>
                  )}
              </div>
           )}
         </div>
       </div>
    </div>
  );
};

export default SettingsPopup; 