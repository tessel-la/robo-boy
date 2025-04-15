import React, { useRef, useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import './VisualizationPanel.css'; // Reuse styles for now

// Consolidated and corrected props interface
interface SettingsPopupProps {
  isOpen: boolean; // Controls visibility
  onClose: () => void; // Correct prop name for closing

  // Fixed Frame
  fixedFrame: string;
  availableFrames: string[];
  onFixedFrameChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;

  // PointCloud Topic
  selectedPointCloudTopic: string;
  availablePointCloudTopics: string[];
  onTopicSelect: (topic: string) => void;
  fetchTopicsError: string | null; // Error during topic fetching
  topicStatus?: 'loading' | 'error' | 'ok' | null; // Status indicator for loading/error states

  // <-- Displayed TF Frames -->
  displayedTfFrames: string[];
  onDisplayedTfFramesChange: (selectedFrames: string[]) => void;
}

// Explicitly type the props object here, then destructure
const SettingsPopup = (props: SettingsPopupProps) => {
  const {
    isOpen,
    onClose, // Correct prop name
    fixedFrame,
    availableFrames,
    onFixedFrameChange,
    selectedPointCloudTopic,
    availablePointCloudTopics,
    onTopicSelect,
    topicStatus,
    fetchTopicsError,
    // <-- Destructure new props -->
    displayedTfFrames,
    onDisplayedTfFramesChange,
  } = props;

  const popupRef = useRef<HTMLDivElement>(null);
  // Removed state and refs related to the custom topic dropdown (isTopicMenuOpen, topicMenuRef)
  // Removed toggleTopic and handleInternalTopicSelect

  // Restore Effect to handle clicks outside the popup
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If the popup is open and the click is outside the popup content, close it
      if (isOpen && popupRef.current && !popupRef.current.contains(event.target as Node)) {
        // Check if the click target is the toggle button itself to prevent immediate reopening
        // IMPORTANT: Also check if click is on the container background (now handled by parent)
        const toggleButton = document.getElementById('viz-settings-button'); // Use correct button ID
        const popupContainer = document.querySelector('.settings-popup-container'); // Get the container

        // Close if click is outside popup content AND not on the toggle button
        // The parent container now handles clicks on the background overlay
        if (!toggleButton || !toggleButton.contains(event.target as Node)) {
             onClose();
        }
      }
    };

    if (isOpen) {
      const timerId = setTimeout(() => {
          document.addEventListener('mousedown', handleClickOutside);
      }, 0);
      return () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]); // Restore dependencies

  // Don't render anything if not open
  if (!isOpen) {
    return null;
  }

  // Determine topic status display for the select element's disabled/option states
  const isLoadingTopics = topicStatus === 'loading';
  const hasTopicError = topicStatus === 'error' || !!fetchTopicsError;
  const noTopicsAvailable = !isLoadingTopics && availablePointCloudTopics.length === 0;

  // <-- Handler for TF checkbox changes -->
  const handleTfCheckboxChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const frameName = event.target.value;
      const isChecked = event.target.checked;
      let newSelectedFrames: string[];

      if (isChecked) {
          // Add frame if not already present
          newSelectedFrames = displayedTfFrames.includes(frameName)
              ? displayedTfFrames
              : [...displayedTfFrames, frameName];
      } else {
          // Remove frame
          newSelectedFrames = displayedTfFrames.filter(f => f !== frameName);
      }
      onDisplayedTfFramesChange(newSelectedFrames);
  };

  return (
    // Restore wrapper div (though maybe not strictly necessary if parent handles overlay)
    // Let's keep it simple for now and remove the wrapper, parent handles overlay
    // <div className="settings-popup-overlay"> 
      <div className="settings-popup" ref={popupRef}>
         <div className="settings-popup-header">
           <h3>Settings</h3>
           <button onClick={onClose} className="close-button icon-button" aria-label="Close settings">
             <FiX />
           </button>
         </div>
         <div className="settings-popup-content">
           {/* Fixed Frame Selector */}
           <div className="popup-control-item">
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

           {/* PointCloud Topic Selector */}
           <div className="popup-control-item">
             <label htmlFor="pointcloud-topic-select">PointCloud Topic:</label>
             <select
               id="pointcloud-topic-select"
               value={selectedPointCloudTopic}
               onChange={(e) => onTopicSelect(e.target.value)}
               disabled={isLoadingTopics || hasTopicError || noTopicsAvailable}
             >
               {isLoadingTopics && <option value="">Loading topics...</option>}
               {hasTopicError && <option value="">Error loading topics</option>}
               {noTopicsAvailable && !isLoadingTopics && !hasTopicError && <option value="">No topics available</option>}
               {!isLoadingTopics && !hasTopicError && availablePointCloudTopics.length > 0 &&
                 availablePointCloudTopics.map((topic) => (
                   <option key={topic} value={topic}>
                     {topic}
                   </option>
                 ))
               }
             </select>
             {hasTopicError && <p className="topic-error-message">{fetchTopicsError || 'Failed to load topics.'}</p>}
           </div>

           {/* <-- Displayed TF Frames Selector --> */}
           <div className="popup-control-group">
                <h4>Displayed TF Frames:</h4>
                {availableFrames.length > 0 ? (
                    <ul className="tf-checkbox-list">
                        {availableFrames.map((frame) => (
                            <li key={frame}>
                                <label>
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
      </div>
    // </div>
  );
};

export default SettingsPopup; 