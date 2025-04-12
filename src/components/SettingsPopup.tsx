import React, { useRef, useState, useEffect } from 'react';
import './VisualizationPanel.css'; // Reuse styles for now, or create a dedicated CSS file

interface SettingsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  // Fixed Frame Props
  fixedFrame: string;
  availableFrames: string[];
  onFixedFrameChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultFixedFrame: string; // Added to handle reset/default logic if needed inside
  // PointCloud Props
  selectedPointCloudTopic: string;
  availablePointCloudTopics: string[];
  fetchTopicsError: string | null;
  onTopicSelect: (topic: string) => void;
  // Maybe pass ros connection status if needed for UI elements inside
  // isRosConnected: boolean;
}

const SettingsPopup: React.FC<SettingsPopupProps> = ({
  isOpen,
  onClose, // We might not need onClose passed in if click outside handles it
  fixedFrame,
  availableFrames,
  onFixedFrameChange,
  defaultFixedFrame,
  selectedPointCloudTopic,
  availablePointCloudTopics,
  fetchTopicsError,
  onTopicSelect,
}) => {
  const settingsPopupRef = useRef<HTMLDivElement>(null);
  const topicMenuRef = useRef<HTMLDivElement>(null);
  const [isTopicMenuOpen, setIsTopicMenuOpen] = useState(false);

  const toggleTopicMenu = () => {
    setIsTopicMenuOpen(!isTopicMenuOpen);
  };

  // Internal handler to call the passed-in onTopicSelect and close the dropdown
  const handleInternalTopicSelect = (topic: string) => {
    onTopicSelect(topic);
    setIsTopicMenuOpen(false);
  };

   // Effect to handle clicks outside the popups (specific to this component)
   useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Close Topic Dropdown if open and click is outside topic section
      if (isTopicMenuOpen && topicMenuRef.current && !topicMenuRef.current.contains(event.target as Node)) {
        setIsTopicMenuOpen(false);
      }
      // Close Settings Popup if open and click is outside settings popup itself
      // We rely on the parent component's state (isOpen) and its click outside logic to close the main popup
      // No need to call onClose here directly, parent controls visibility.
    };

    // Add listener only when the popup is actually open
    if (isOpen) {
      // Use setTimeout to ensure the listener is added after the click that opened the popup
      const timerId = setTimeout(() => {
          document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    } 
    // No listener needed if not open
    return () => {}; 

  }, [isOpen, isTopicMenuOpen]); // Re-run if isOpen or topic menu state changes


  // Don't render anything if not open
  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-popup" ref={settingsPopupRef}>
      <h4>Visualization Settings</h4>

      {/* Fixed Frame Selector */}
      <div className="popup-control-item">
        <label htmlFor="fixedFrameSelect">Fixed Frame:</label>
        <select
          id="fixedFrameSelect"
          value={fixedFrame}
          onChange={onFixedFrameChange} // Pass handler directly
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

      {/* PointCloud Topic Selector */}
      <div className="popup-control-item topic-selector-control" ref={topicMenuRef}>
        <label>PointCloud Topic:</label> {/* Simple label */}
        <button onClick={toggleTopicMenu} className="topic-selector-button">
          {selectedPointCloudTopic || 'Select PointCloud Topic'} <span className={`arrow ${isTopicMenuOpen ? 'up' : 'down'}`}></span>
        </button>
        {isTopicMenuOpen && (
          <ul className="topic-selector-dropdown">
            {fetchTopicsError ? (
              <li className="topic-item error">{fetchTopicsError}</li>
            ) : availablePointCloudTopics.length > 0 ? (
              availablePointCloudTopics.map((topic) => (
                <li key={topic} onClick={() => handleInternalTopicSelect(topic)} className="topic-item">
                  {topic}
                </li>
              ))
            ) : (
              <li className="topic-item disabled">No PointCloud2 topics found</li>
            )}
          </ul>
        )}
      </div>

      {/* Add more settings here if needed */}
    </div>
  );
};

export default SettingsPopup; 