import React, { useState, useEffect, useMemo } from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import './ComponentSettingsModal.css';

interface ComponentSettingsModalProps {
  isOpen: boolean;
  component: GamepadComponentConfig | null;
  onClose: () => void;
  onSave: (config: GamepadComponentConfig) => void;
  ros?: Ros; // Add ROS connection for topic fetching
}

interface TopicInfo {
  name: string;
  type: string;
}

// Define supported message types and their characteristics
const MESSAGE_TYPES = {
  'sensor_msgs/Joy': {
    label: 'Joy Message',
    fields: {
      'axes': { type: 'number_array', label: 'Axes (float array)' },
      'buttons': { type: 'boolean_array', label: 'Buttons (boolean array)' }
    }
  },
  'geometry_msgs/Twist': {
    label: 'Twist Message',
    fields: {
      'linear.x': { type: 'float', label: 'Linear X' },
      'linear.y': { type: 'float', label: 'Linear Y' },
      'linear.z': { type: 'float', label: 'Linear Z' },
      'angular.x': { type: 'float', label: 'Angular X' },
      'angular.y': { type: 'float', label: 'Angular Y' },
      'angular.z': { type: 'float', label: 'Angular Z' }
    }
  },
  'std_msgs/Float32': {
    label: 'Float32',
    fields: {
      'data': { type: 'float', label: 'Data' }
    }
  },
  'std_msgs/Float64': {
    label: 'Float64',
    fields: {
      'data': { type: 'double', label: 'Data' }
    }
  },
  'std_msgs/Int32': {
    label: 'Int32',
    fields: {
      'data': { type: 'int', label: 'Data' }
    }
  },
  'std_msgs/Bool': {
    label: 'Boolean',
    fields: {
      'data': { type: 'bool', label: 'Data' }
    }
  }
};

const ComponentSettingsModal: React.FC<ComponentSettingsModalProps> = ({
  isOpen,
  component,
  onClose,
  onSave,
  ros
}) => {
  const [label, setLabel] = useState('');
  const [topic, setTopic] = useState('');
  const [messageType, setMessageType] = useState('');
  const [field, setField] = useState('');
  const [availableTopics, setAvailableTopics] = useState<TopicInfo[]>([]);
  
  // Joystick-specific settings
  const [dataType, setDataType] = useState<'float' | 'int'>('float');
  const [valueRange, setValueRange] = useState({ min: -1, max: 1 });
  const [axisSelection, setAxisSelection] = useState<'xy' | 'zw'>('xy'); // First 2 or second 2 axes
  const [customAxes, setCustomAxes] = useState<string[]>(['0', '1']);
  const [useCustomAxes, setUseCustomAxes] = useState(false);
  
  // Button-specific settings
  const [buttonIndex, setButtonIndex] = useState(0);
  const [momentary, setMomentary] = useState(true);
  
  // Loading state
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);

  // Fetch available topics when modal opens
  useEffect(() => {
    if (isOpen && ros && ros.isConnected) {
      setIsLoadingTopics(true);
      ros.getTopics(
        (response: { topics: string[]; types: string[] }) => {
          const fetchedTopics: TopicInfo[] = response.topics.map((topic, index) => ({
            name: topic,
            type: response.types[index],
          }));
          setAvailableTopics(fetchedTopics);
          setIsLoadingTopics(false);
        },
        (error: any) => {
          console.error('Failed to fetch topics:', error);
          setAvailableTopics([]);
          setIsLoadingTopics(false);
        }
      );
    } else if (!isOpen) {
      setAvailableTopics([]);
    }
  }, [isOpen, ros]);

  // Initialize form data when component changes
  useEffect(() => {
    if (component) {
      setLabel(component.label || '');
      
      const action = component.action as ROSTopicConfig;
      if (action) {
        setTopic(action.topic || '');
        setMessageType(action.messageType || 'sensor_msgs/Joy');
        setField(action.field || (component.type === 'joystick' ? 'axes' : 'buttons'));
      }
      
      // Initialize component-specific settings
      if (component.config) {
        if (component.type === 'joystick') {
          setValueRange({
            min: component.config.min ?? -1,
            max: component.config.max ?? component.config.maxValue ?? 1
          });
          
          if (component.config.axes) {
            setCustomAxes(component.config.axes);
            setUseCustomAxes(true);
            // Determine if it's xy or zw based on the axes
            const axes = component.config.axes;
            if (axes.includes('0') && axes.includes('1')) {
              setAxisSelection('xy');
            } else if (axes.includes('2') && axes.includes('3')) {
              setAxisSelection('zw');
            } else {
              setUseCustomAxes(true);
            }
          }
        } else if (component.type === 'button') {
          setButtonIndex(component.config.buttonIndex ?? 0);
          setMomentary(component.config.momentary ?? true);
        }
      }
    }
  }, [component]);

  // Get available topics filtered by message type
  const filteredTopics = useMemo(() => {
    if (!messageType) return availableTopics;
    return availableTopics.filter(t => t.type === messageType);
  }, [availableTopics, messageType]);

  // Get available fields for the selected message type
  const availableFields = useMemo(() => {
    if (!messageType || !MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES]) {
      return {};
    }
    return MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES].fields;
  }, [messageType]);

  const handleSave = () => {
    if (!component) return;

    // Build the updated configuration
    const action: ROSTopicConfig = {
      topic,
      messageType,
      field: field || undefined
    };

    let updatedConfig = { ...component.config };

    // Add component-specific configuration
    if (component.type === 'joystick') {
      updatedConfig = {
        ...updatedConfig,
        maxValue: dataType === 'float' ? valueRange.max : Math.floor(valueRange.max),
        min: dataType === 'float' ? valueRange.min : Math.floor(valueRange.min),
        max: dataType === 'float' ? valueRange.max : Math.floor(valueRange.max),
        axes: useCustomAxes ? customAxes : (axisSelection === 'xy' ? ['0', '1'] : ['2', '3'])
      };
    } else if (component.type === 'button') {
      updatedConfig = {
        ...updatedConfig,
        buttonIndex,
        momentary
      };
    }

    const updatedComponent: GamepadComponentConfig = {
      ...component,
      label,
      action,
      config: updatedConfig
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
      <div className="enhanced-component-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Configure {component.type.charAt(0).toUpperCase() + component.type.slice(1)}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-content">
          {/* Basic Settings */}
          <div className="settings-section">
            <h4>Basic Settings</h4>
            
            <div className="setting-group">
              <label htmlFor="component-label">Display Label:</label>
              <input
                id="component-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Enter display label"
                className="setting-input"
              />
            </div>
          </div>

          {/* Topic Configuration */}
          <div className="settings-section">
            <h4>ROS Topic Configuration</h4>
            
            <div className="setting-group">
              <label htmlFor="message-type">Message Type:</label>
              <select
                id="message-type"
                value={messageType}
                onChange={(e) => setMessageType(e.target.value)}
                className="setting-select"
              >
                <option value="">Select message type...</option>
                {Object.entries(MESSAGE_TYPES).map(([type, info]) => (
                  <option key={type} value={type}>{info.label} ({type})</option>
                ))}
              </select>
            </div>

            <div className="setting-group">
              <label htmlFor="topic-name">Topic:</label>
              <div className="topic-input-group">
                <select
                  id="topic-select"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="setting-select topic-select"
                  disabled={isLoadingTopics}
                >
                  <option value="">
                    {isLoadingTopics ? 'Loading topics...' : 'Select existing topic...'}
                  </option>
                  {filteredTopics.map((topicInfo) => (
                    <option key={topicInfo.name} value={topicInfo.name}>
                      {topicInfo.name}
                    </option>
                  ))}
                </select>
                <span className="topic-input-separator">or</span>
                <input
                  id="topic-custom"
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter custom topic name"
                  className="setting-input topic-input"
                />
              </div>
              {messageType && filteredTopics.length === 0 && !isLoadingTopics && (
                <div className="topic-warning">
                  No existing topics found for {messageType}. You can enter a custom topic name.
                </div>
              )}
            </div>

            {messageType && Object.keys(availableFields).length > 0 && (
              <div className="setting-group">
                <label htmlFor="field-select">Message Field:</label>
                <select
                  id="field-select"
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                  className="setting-select"
                >
                  <option value="">Select field...</option>
                  {Object.entries(availableFields).map(([fieldName, fieldInfo]) => (
                    <option key={fieldName} value={fieldName}>
                      {fieldInfo.label} ({fieldName})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Component-specific Settings */}
          {component.type === 'joystick' && (
            <div className="settings-section">
              <h4>Joystick Settings</h4>
              
              <div className="setting-group">
                <label htmlFor="data-type">Data Type:</label>
                <select
                  id="data-type"
                  value={dataType}
                  onChange={(e) => setDataType(e.target.value as 'float' | 'int')}
                  className="setting-select"
                >
                  <option value="float">Float (decimal numbers)</option>
                  <option value="int">Integer (whole numbers)</option>
                </select>
              </div>

              <div className="setting-group">
                <label>Value Range:</label>
                <div className="range-inputs">
                  <div className="range-input-item">
                    <label htmlFor="min-value">Min:</label>
                    <input
                      id="min-value"
                      type="number"
                      value={valueRange.min}
                      onChange={(e) => setValueRange(prev => ({ ...prev, min: parseFloat(e.target.value) }))}
                      step={dataType === 'float' ? '0.1' : '1'}
                      className="setting-input small"
                    />
                  </div>
                  <div className="range-input-item">
                    <label htmlFor="max-value">Max:</label>
                    <input
                      id="max-value"
                      type="number"
                      value={valueRange.max}
                      onChange={(e) => setValueRange(prev => ({ ...prev, max: parseFloat(e.target.value) }))}
                      step={dataType === 'float' ? '0.1' : '1'}
                      className="setting-input small"
                    />
                  </div>
                </div>
              </div>

              <div className="setting-group">
                <label>Axis Configuration:</label>
                <div className="axis-config">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={useCustomAxes}
                      onChange={(e) => setUseCustomAxes(e.target.checked)}
                    />
                    Use custom axis mapping
                  </label>
                  
                  {!useCustomAxes && (
                    <div className="axis-selection">
                      <label className="radio-label">
                        <input
                          type="radio"
                          value="xy"
                          checked={axisSelection === 'xy'}
                          onChange={(e) => setAxisSelection(e.target.value as 'xy' | 'zw')}
                        />
                        First 2 axes (X, Y) - indices 0, 1
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          value="zw"
                          checked={axisSelection === 'zw'}
                          onChange={(e) => setAxisSelection(e.target.value as 'xy' | 'zw')}
                        />
                        Second 2 axes (Z, W) - indices 2, 3
                      </label>
                    </div>
                  )}

                  {useCustomAxes && (
                    <div className="custom-axes">
                      <label htmlFor="custom-axes-input">Custom Axes (comma-separated indices):</label>
                      <input
                        id="custom-axes-input"
                        type="text"
                        value={customAxes.join(', ')}
                        onChange={(e) => setCustomAxes(e.target.value.split(',').map(s => s.trim()).filter(s => s))}
                        placeholder="0, 1"
                        className="setting-input"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {component.type === 'button' && (
            <div className="settings-section">
              <h4>Button Settings</h4>
              
              <div className="setting-group">
                <label htmlFor="button-index">Button Index:</label>
                <input
                  id="button-index"
                  type="number"
                  value={buttonIndex}
                  onChange={(e) => setButtonIndex(parseInt(e.target.value))}
                  min="0"
                  className="setting-input small"
                />
              </div>

              <div className="setting-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={momentary}
                    onChange={(e) => setMomentary(e.target.checked)}
                  />
                  Momentary (press and release) vs Toggle
                </label>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={handleCancel}>
            Cancel
          </button>
          <button 
            className="save-btn" 
            onClick={handleSave}
            disabled={!topic || !messageType}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComponentSettingsModal; 