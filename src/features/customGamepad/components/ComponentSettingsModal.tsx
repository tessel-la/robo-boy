import React, { useState, useEffect } from 'react';
import { GamepadComponentConfig } from '../types';
import './ComponentSettingsModal.css';

interface ComponentSettingsModalProps {
  isOpen: boolean;
  component: GamepadComponentConfig | null;
  onClose: () => void;
  onSave: (config: GamepadComponentConfig) => void;
}

const ComponentSettingsModal: React.FC<ComponentSettingsModalProps> = ({
  isOpen,
  component,
  onClose,
  onSave
}) => {
  const [label, setLabel] = useState('');
  const [topic, setTopic] = useState('');

  useEffect(() => {
    if (component) {
      setLabel(component.label || '');
      setTopic((component.action as any)?.topic || '');
    }
  }, [component]);

  const handleSave = () => {
    if (!component) return;

    const updatedComponent: GamepadComponentConfig = {
      ...component,
      label,
      action: {
        ...component.action,
        topic
      } as any
    };

    onSave(updatedComponent);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  if (!isOpen || !component) return null;

  return (
    <div className="component-settings-modal-overlay" onClick={onClose}>
      <div className="component-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Component Settings</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-content">
          <div className="setting-group">
            <label htmlFor="component-label">Label:</label>
            <input
              id="component-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Component label"
            />
          </div>
          
          <div className="setting-group">
            <label htmlFor="component-topic">ROS Topic:</label>
            <input
              id="component-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="/joy"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button className="save-btn" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComponentSettingsModal; 