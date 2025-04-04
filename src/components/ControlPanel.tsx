import React, { useState } from 'react';
import type { Ros } from 'roslib'; // Import Ros type
import PadControl from './PadControl'; // Create next
import VoiceControl from './VoiceControl'; // Create next
import './ControlPanel.css';

interface ControlPanelProps {
  ros: Ros; // Receive the ROS instance
}

type ControlMode = 'pad' | 'voice';

const ControlPanel: React.FC<ControlPanelProps> = ({ ros }) => {
  const [controlMode, setControlMode] = useState<ControlMode>('pad');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleModeChange = (newMode: ControlMode) => {
    if (newMode !== controlMode) {
      setIsTransitioning(true);
      // Wait for the fade-out animation to complete before switching content
      setTimeout(() => {
        setControlMode(newMode);
        setIsTransitioning(false); // Fade-in starts automatically via CSS
      }, 200); // Match animation duration
    }
  };

  return (
    <div className="control-panel-wrapper">
      <div className="control-mode-toggle">
        <button
          onClick={() => handleModeChange('pad')}
          className={controlMode === 'pad' ? 'active' : ''}
          disabled={isTransitioning}
        >
          Pad Control
        </button>
        <button
          onClick={() => handleModeChange('voice')}
          className={controlMode === 'voice' ? 'active' : ''}
          disabled={isTransitioning}
        >
          Voice Control
        </button>
      </div>

      <div className={`control-content ${isTransitioning ? 'fade-out' : 'fade-in'}`}>
        {controlMode === 'pad' ? (
          <PadControl ros={ros} />
        ) : (
          <VoiceControl ros={ros} />
        )}
      </div>
    </div>
  );
};

export default ControlPanel; 