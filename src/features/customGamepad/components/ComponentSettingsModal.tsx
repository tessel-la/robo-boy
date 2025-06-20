import React, { useState, useEffect, useMemo } from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import RangeSlider from './RangeSlider';
import ValueControl from './ValueControl';
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
    alternativeTypes: ['sensor_msgs/msg/Joy'], // ROS2 format
    fields: {
      'axes': { type: 'number_array', label: 'Axes (float array)' },
      'buttons': { type: 'boolean_array', label: 'Buttons (boolean array)' }
    }
  },
  'geometry_msgs/Twist': {
    label: 'Twist Message',
    alternativeTypes: ['geometry_msgs/msg/Twist'], // ROS2 format
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
    alternativeTypes: ['std_msgs/msg/Float32'], // ROS2 format
    fields: {
      'data': { type: 'float', label: 'Data' }
    }
  },
  'std_msgs/Float64': {
    label: 'Float64',
    alternativeTypes: ['std_msgs/msg/Float64'], // ROS2 format
    fields: {
      'data': { type: 'double', label: 'Data' }
    }
  },
  'std_msgs/Int32': {
    label: 'Int32',
    alternativeTypes: ['std_msgs/msg/Int32'], // ROS2 format
    fields: {
      'data': { type: 'int', label: 'Data' }
    }
  },
  'std_msgs/Bool': {
    label: 'Boolean',
    alternativeTypes: ['std_msgs/msg/Bool'], // ROS2 format
    fields: {
      'data': { type: 'bool', label: 'Data' }
    }
  }
};

// Define allowed message types for each component type
const COMPONENT_MESSAGE_TYPES: Record<string, string[]> = {
  'joystick': ['sensor_msgs/Joy', 'geometry_msgs/Twist', 'std_msgs/Float32', 'std_msgs/Float64', 'std_msgs/Int32'],
  'button': [ 'std_msgs/Bool', 'std_msgs/Int32'],
  'dpad': ['sensor_msgs/Joy'], // D-pad only supports Joy
  'toggle': ['std_msgs/Bool'], // Toggle only supports Boolean
  'slider': ['std_msgs/Float32', 'std_msgs/Float64', 'std_msgs/Int32']
};

const getInferredDataType = (messageType: string, field: string): 'float' | 'int' => {
  if (messageType.includes('Int')) {
    return 'int';
  }
  if (messageType.includes('Float')) {
    return 'float';
  }
  if (messageType === 'sensor_msgs/Joy' && field === 'axes') {
    return 'float';
  }
  // Default to float for Twist messages or other numeric types
  if (messageType.startsWith('geometry_msgs/')) {
    return 'float';
  }
  return 'float';
};

// Helper function to check if axis configuration should be enabled
const isAxisConfigurationEnabled = (messageType: string): boolean => {
  return messageType === 'sensor_msgs/Joy' || 
         messageType === 'sensor_msgs/msg/Joy' ||
         messageType === 'geometry_msgs/Twist' || 
         messageType === 'geometry_msgs/msg/Twist';
};

// Helper function to check if this is a twist message type
const isTwistMessageType = (messageType: string): boolean => {
  return messageType === 'geometry_msgs/Twist' || messageType === 'geometry_msgs/msg/Twist';
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
  const [valueRange, setValueRange] = useState({ min: -1, max: 1 });
  const [sliderMin, setSliderMin] = useState(-1);
  const [sliderMax, setSliderMax] = useState(1);
  const [axisSelection, setAxisSelection] = useState<'xy' | 'zw'>('xy'); // First 2 or second 2 axes
  const [customAxes, setCustomAxes] = useState<string[]>(['0', '1']);
  const [useCustomAxes, setUseCustomAxes] = useState(false);
  
  // New twist-specific settings
  const [twistAxes, setTwistAxes] = useState<string[]>(['linear.x', 'linear.y']);
  const [useTwistCustomAxes, setUseTwistCustomAxes] = useState(false);
  
  // D-pad-specific settings
  const [dpadButtonMapping, setDpadButtonMapping] = useState<Record<string, number>>({
    up: 0, right: 1, down: 2, left: 3
  });
  
  // Button-specific settings
  const [buttonIndex, setButtonIndex] = useState(0);
  const [momentary, setMomentary] = useState(true);
  
  // Loading state
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  
  // Error state
  const [errorMessage, setErrorMessage] = useState('');

  // Continuous topic validation effect
  useEffect(() => {
    // Clear error message initially
    setErrorMessage('');

    // Only validate if we have a topic name and message type
    if (!topic || !messageType || availableTopics.length === 0) {
      return;
    }

    // Check if custom topic name conflicts with existing topic with different message type
    const existingTopic = availableTopics.find(t => t.name === topic);
    if (existingTopic) {
      // Get the message type configuration to check for alternative formats
      const messageConfig = MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES];
      const acceptableTypes = messageConfig 
        ? [messageType, ...(messageConfig.alternativeTypes || [])]
        : [messageType];
      
      // Check if the existing topic type matches any acceptable format
      if (!acceptableTypes.includes(existingTopic.type)) {
        setErrorMessage(`Topic name "${topic}" is already in use by an existing topic with message type "${existingTopic.type}". Please choose a different topic name or select the correct message type.`);
      }
    }
  }, [topic, messageType, availableTopics]);

  const getPrecision = (num: number) => {
    const numString = String(num);
    if (numString.includes('.')) {
      return numString.split('.')[1].length;
    }
    return 0;
  };

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
        
        // Force component-specific message type restrictions
        if (component.type === 'dpad') {
          setMessageType(action.messageType || 'sensor_msgs/Joy');
          setField('buttons');
        } else if (component.type === 'toggle') {
          // Force toggle to use Bool message type and data field - always
          const validToggleType = ['std_msgs/Bool', 'std_msgs/msg/Bool'].includes(action.messageType || '') 
            ? action.messageType 
            : 'std_msgs/Bool';
          setMessageType(validToggleType);
          setField('data');
        } else {
          setMessageType(action.messageType || 'sensor_msgs/Joy');
          setField(action.field || (component.type === 'joystick' ? 'axes' : 'buttons'));
        }
      } else if (component.type === 'dpad') {
        // Set defaults for new D-pad components
        setMessageType('sensor_msgs/Joy');
        setField('buttons');
      } else if (component.type === 'toggle') {
        // Set defaults for new toggle components - always Bool
        setMessageType('std_msgs/Bool');
        setField('data');
      }
      
      // Initialize component-specific settings
      if (component.config) {
        if (component.type === 'joystick') {
          const min = component.config.min ?? -1;
          const max = component.config.max ?? 1;
          
          const inferredStep = getInferredDataType(action.messageType || 'sensor_msgs/Joy', action.field || 'axes') === 'float' ? 0.1 : 1;
          const minPrecision = getPrecision(inferredStep);

          setValueRange({
            min: parseFloat(min.toFixed(minPrecision)),
            max: parseFloat(max.toFixed(minPrecision))
          });
          setSliderMin(parseFloat((component.config.sliderMin ?? min).toFixed(minPrecision)));
          setSliderMax(parseFloat((component.config.sliderMax ?? max).toFixed(minPrecision)));
          
          if (component.config.axes) {
            const axes = component.config.axes;
            
            // Check if this is a twist message type
            if (isTwistMessageType(action.messageType || '')) {
              setTwistAxes(axes);
              // Check if it's using standard combinations or custom
              const standardLinearCombos = [
                ['linear.x', 'linear.y'],
                ['linear.y', 'linear.z'],
                ['linear.x', 'linear.z']
              ];
              const standardAngularCombos = [
                ['angular.x', 'angular.y'],
                ['angular.y', 'angular.z'],
                ['angular.x', 'angular.z']
              ];
              const isStandardCombo = standardLinearCombos.concat(standardAngularCombos)
                .some(combo => combo.length === axes.length && combo.every((axis, index) => axis === axes[index]));
              setUseTwistCustomAxes(!isStandardCombo);
            } else {
              // Joy message type
              setCustomAxes(axes);
              // Determine if it's xy or zw based on the axes
              if (axes.includes('0') && axes.includes('1')) {
                setAxisSelection('xy');
                setUseCustomAxes(false);
              } else if (axes.includes('2') && axes.includes('3')) {
                setAxisSelection('zw');
                setUseCustomAxes(false);
              } else {
                setUseCustomAxes(true);
              }
            }
          }
        } else if (component.type === 'button') {
          setButtonIndex(component.config.buttonIndex ?? 0);
          setMomentary(component.config.momentary ?? true);
        } else if (component.type === 'dpad') {
          // Initialize D-pad button mapping
          setDpadButtonMapping(component.config.buttonMapping || {
            up: 0, right: 1, down: 2, left: 3
          });
        }
      }
    }
  }, [component]);

  const inferredDataType = useMemo(() => getInferredDataType(messageType, field), [messageType, field]);

  // Get available topics filtered by message type
  const filteredTopics = useMemo(() => {
    if (!messageType) return availableTopics;
    
    // Get the message type configuration
    const messageConfig = MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES];
    if (!messageConfig) return [];
    
    // Create a list of all possible type formats to match against
    const typesToMatch = [messageType, ...(messageConfig.alternativeTypes || [])];
    
    const filtered = availableTopics.filter(topic => 
      typesToMatch.some(typeToMatch => topic.type === typeToMatch)
    );
    
    // Debug logging to help troubleshoot
    console.log('Filtering topics for message type:', messageType);
    console.log('Types to match:', typesToMatch);
    console.log('Available topics:', availableTopics.map(t => `${t.name} (${t.type})`));
    console.log('Filtered topics:', filtered.map(t => `${t.name} (${t.type})`));
    
    return filtered;
  }, [availableTopics, messageType]);

  // Get available fields for the selected message type
  const availableFields = useMemo(() => {
    if (!messageType || !MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES]) {
      return {};
    }
    return MESSAGE_TYPES[messageType as keyof typeof MESSAGE_TYPES].fields;
  }, [messageType]);

  // Get allowed message types for the current component type
  const allowedMessageTypes = useMemo(() => {
    if (!component) return [];
    return COMPONENT_MESSAGE_TYPES[component.type] || [];
  }, [component?.type]);

  const handleSave = () => {
    if (!component) return;

    // Additional validation for toggle components
    if (component.type === 'toggle') {
      if (!['std_msgs/Bool', 'std_msgs/msg/Bool'].includes(messageType)) {
        setErrorMessage('Toggle components can only use Boolean message types (std_msgs/Bool).');
        return;
      }
      if (field !== 'data') {
        setErrorMessage('Toggle components can only use the "data" field.');
        return;
      }
    }

    // Additional validation for dpad components
    if (component.type === 'dpad') {
      if (!['sensor_msgs/Joy', 'sensor_msgs/msg/Joy'].includes(messageType)) {
        setErrorMessage('D-Pad components can only use Joy message types (sensor_msgs/Joy).');
        return;
      }
      if (field !== 'buttons') {
        setErrorMessage('D-Pad components can only use the "buttons" field.');
        return;
      }
    }

    const dataType = getInferredDataType(messageType, field);
    const precision = getPrecision(dataType === 'float' ? 0.1 : 1);

    // Build the updated configuration
    const action: ROSTopicConfig = {
      topic,
      messageType,
      field: field || undefined
    };

    let updatedConfig = { ...component.config };

    // Add component-specific configuration
    if (component.type === 'joystick') {
      let axesToUse: string[];
      
      if (isTwistMessageType(messageType)) {
        axesToUse = useTwistCustomAxes ? twistAxes : twistAxes;
      } else {
        axesToUse = useCustomAxes ? customAxes : (axisSelection === 'xy' ? ['0', '1'] : ['2', '3']);
      }
      
      updatedConfig = {
        ...updatedConfig,
        min: parseFloat(valueRange.min.toFixed(precision)),
        max: parseFloat(valueRange.max.toFixed(precision)),
        sliderMin: parseFloat(sliderMin.toFixed(precision)),
        sliderMax: parseFloat(sliderMax.toFixed(precision)),
        axes: axesToUse
      };
      // Remove legacy maxValue if it exists
      delete updatedConfig.maxValue;
    } else if (component.type === 'button') {
      updatedConfig = {
        ...updatedConfig,
        buttonIndex,
        momentary
      };
    } else if (component.type === 'dpad') {
      updatedConfig = {
        ...updatedConfig,
        buttonMapping: dpadButtonMapping
      };
    } else if (component.type === 'toggle') {
      // For toggle, we don't need any special config beyond the topic and message type
      // The component is purely boolean on/off
      updatedConfig = {
        ...updatedConfig,
        // Remove any incompatible config that might have been carried over
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
                onChange={(e) => {
                  const newMessageType = e.target.value;
                  setMessageType(newMessageType);
                  // Auto-set field for restricted components
                  if (component?.type === 'toggle' && newMessageType.includes('Bool')) {
                    setField('data');
                  } else if (component?.type === 'dpad' && newMessageType.includes('Joy')) {
                    setField('buttons');
                  }
                }}
                className="setting-select"
                disabled={component.type === 'dpad' || component.type === 'toggle'}
              >
                <option value="">Select message type...</option>
                {component.type === 'dpad' ? (
                  // Only show Joy message types for D-pad
                  allowedMessageTypes.filter(type => type.includes('Joy')).map(type => (
                    <option key={type} value={type}>
                      {MESSAGE_TYPES[type as keyof typeof MESSAGE_TYPES]?.label} ({type})
                    </option>
                  ))
                ) : component.type === 'toggle' ? (
                  // Only show Boolean message types for Toggle
                  allowedMessageTypes.filter(type => type.includes('Bool')).map(type => (
                    <option key={type} value={type}>
                      {MESSAGE_TYPES[type as keyof typeof MESSAGE_TYPES]?.label} ({type})
                    </option>
                  ))
                ) : (
                  // Show allowed message types for other components
                  allowedMessageTypes.map(type => (
                    <option key={type} value={type}>
                      {MESSAGE_TYPES[type as keyof typeof MESSAGE_TYPES]?.label} ({type})
                    </option>
                  ))
                )}
              </select>
              {component.type === 'dpad' && (
                <small className="axis-help-text">
                  D-Pad components only support Joy message types for directional button control.
                </small>
              )}
              {component.type === 'toggle' && (
                <small className="axis-help-text">
                  Toggle components only support Boolean message types (std_msgs/Bool) for true/false state control.
                </small>
              )}
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
                  {filteredTopics.length > 0 ? (
                    filteredTopics.map((topicInfo) => (
                      <option key={topicInfo.name} value={topicInfo.name}>
                        {topicInfo.name} ({topicInfo.type})
                      </option>
                    ))
                  ) : messageType ? (
                    <option disabled>No {messageType} topics found</option>
                  ) : (
                    <option disabled>Select message type first</option>
                  )}
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
              {errorMessage ? (
                <div className="error-message-inline">
                  <div className="error-content-inline">
                    <span className="error-icon">⚠️</span>
                    <span className="error-text">{errorMessage}</span>
                  </div>
                </div>
              ) : (
                <>
                  {messageType && filteredTopics.length === 0 && availableTopics.length > 0 && !isLoadingTopics && (
                    <div className="topic-warning">
                      No existing topics found for {messageType}. Please enter a custom topic name below.
                    </div>
                  )}
                  {messageType && availableTopics.length === 0 && !isLoadingTopics && (
                    <div className="topic-warning">
                      No topics available from ROS. Make sure ROS is connected and topics are being published.
                    </div>
                  )}
                </>
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
                  disabled={component.type === 'dpad' || component.type === 'toggle'}
                >
                  <option value="">Select field...</option>
                  {component.type === 'dpad' ? (
                    // Only show buttons field for D-pad
                    <option value="buttons">Buttons (buttons)</option>
                  ) : component.type === 'toggle' ? (
                    // Only show data field for Toggle
                    <option value="data">Data (data)</option>
                  ) : (
                    // Show all available fields for other components
                    Object.entries(availableFields).map(([fieldName, fieldInfo]) => (
                      <option key={fieldName} value={fieldName}>
                        {fieldInfo.label} ({fieldName})
                      </option>
                    ))
                  )}
                </select>
                {component.type === 'dpad' && (
                  <small className="axis-help-text">
                    D-Pad components use the buttons field to map directional presses to button indices.
                  </small>
                )}
                {component.type === 'toggle' && (
                  <small className="axis-help-text">
                    Toggle components use the data field to control boolean state (true/false).
                  </small>
                )}
              </div>
            )}
          </div>

          {/* Component-specific Settings */}
          {component.type === 'joystick' && (
            <div className="settings-section">
              <h4>Joystick Settings</h4>
              
              <div className="setting-group range-controls">
                <ValueControl
                  label="Slider Min"
                  value={sliderMin}
                  onChange={setSliderMin}
                  step={inferredDataType === 'float' ? 0.1 : 1}
                  max={sliderMax}
                />
                <ValueControl
                  label="Slider Max"
                  value={sliderMax}
                  onChange={setSliderMax}
                  step={inferredDataType === 'float' ? 0.1 : 1}
                  min={sliderMin}
                />
              </div>

              <div className="setting-group">
                <label>Value Range:</label>
                <RangeSlider
                  min={sliderMin}
                  max={sliderMax}
                  step={inferredDataType === 'float' ? 0.1 : 1}
                  minValue={valueRange.min}
                  maxValue={valueRange.max}
                  onChange={(newRange) => {
                    setValueRange({
                      min: Math.max(sliderMin, newRange.min),
                      max: Math.min(sliderMax, newRange.max),
                    });
                  }}
                />
              </div>

              {/* Only show axis configuration for Joy and Twist message types */}
              {isAxisConfigurationEnabled(messageType) && (
                <div className="setting-group">
                  <label>Axis Configuration:</label>
                  <div className="axis-config">
                    {isTwistMessageType(messageType) ? (
                      /* Twist message type axis configuration */
                      <>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={useTwistCustomAxes}
                            onChange={(e) => setUseTwistCustomAxes(e.target.checked)}
                          />
                          Use custom axis mapping
                        </label>
                        
                        {!useTwistCustomAxes && (
                          <div className="axis-selection">
                            <h5>Linear Movement:</h5>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="linear.x,linear.y"
                                checked={twistAxes.join(',') === 'linear.x,linear.y'}
                                onChange={() => setTwistAxes(['linear.x', 'linear.y'])}
                              />
                              Linear X and Y (horizontal movement)
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="linear.y,linear.z"
                                checked={twistAxes.join(',') === 'linear.y,linear.z'}
                                onChange={() => setTwistAxes(['linear.y', 'linear.z'])}
                              />
                              Linear Y and Z (vertical movement)
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="linear.x,linear.z"
                                checked={twistAxes.join(',') === 'linear.x,linear.z'}
                                onChange={() => setTwistAxes(['linear.x', 'linear.z'])}
                              />
                              Linear X and Z
                            </label>
                            
                            <h5>Angular Movement:</h5>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="angular.x,angular.y"
                                checked={twistAxes.join(',') === 'angular.x,angular.y'}
                                onChange={() => setTwistAxes(['angular.x', 'angular.y'])}
                              />
                              Angular X and Y (rotation)
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="angular.y,angular.z"
                                checked={twistAxes.join(',') === 'angular.y,angular.z'}
                                onChange={() => setTwistAxes(['angular.y', 'angular.z'])}
                              />
                              Angular Y and Z
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="angular.x,angular.z"
                                checked={twistAxes.join(',') === 'angular.x,angular.z'}
                                onChange={() => setTwistAxes(['angular.x', 'angular.z'])}
                              />
                              Angular X and Z
                            </label>
                            
                            <h5>Mixed Linear/Angular:</h5>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="linear.x,angular.z"
                                checked={twistAxes.join(',') === 'linear.x,angular.z'}
                                onChange={() => setTwistAxes(['linear.x', 'angular.z'])}
                              />
                              Linear X and Angular Z (common for robot base)
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="linear.y,angular.z"
                                checked={twistAxes.join(',') === 'linear.y,angular.z'}
                                onChange={() => setTwistAxes(['linear.y', 'angular.z'])}
                              />
                              Linear Y and Angular Z
                            </label>
                          </div>
                        )}

                        {useTwistCustomAxes && (
                          <div className="custom-axes">
                            <label htmlFor="twist-custom-axes-input">Custom Twist Axes (comma-separated):</label>
                            <input
                              id="twist-custom-axes-input"
                              type="text"
                              value={twistAxes.join(', ')}
                              onChange={(e) => setTwistAxes(e.target.value.split(',').map(s => s.trim()).filter(s => s))}
                              placeholder="linear.x, angular.z"
                              className="setting-input"
                            />
                            <small className="axis-help-text">
                              Available: linear.x, linear.y, linear.z, angular.x, angular.y, angular.z
                            </small>
                          </div>
                        )}
                      </>
                    ) : (
                      /* Joy message type axis configuration (original) */
                      <>
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
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Show message when axis configuration is disabled */}
              {!isAxisConfigurationEnabled(messageType) && messageType && (
                <div className="setting-group">
                  <div className="axis-config-disabled">
                    <p>Axis configuration is only available for Joy and Twist message types.</p>
                    <p>Current message type <strong>{messageType}</strong> uses default single-value mapping.</p>
                  </div>
                </div>
              )}
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

          {component.type === 'dpad' && (
            <div className="settings-section">
              <h4>D-Pad Settings</h4>
              
              {/* Force Joy message type for D-pad */}
              {messageType && messageType !== 'sensor_msgs/Joy' && messageType !== 'sensor_msgs/msg/Joy' && (
                <div className="setting-group">
                  <div className="axis-config-disabled">
                    <p><strong>Important:</strong> D-Pad only supports Joy message types.</p>
                    <p>Please select <strong>sensor_msgs/Joy</strong> as the message type for proper D-Pad functionality.</p>
                  </div>
                </div>
              )}

              {(!messageType || messageType === 'sensor_msgs/Joy' || messageType === 'sensor_msgs/msg/Joy') && (
                <div className="setting-group">
                  <label>Button Mapping:</label>
                  <div className="axis-config">
                    <div className="dpad-button-mapping">
                      <div className="button-mapping-grid">
                        <div className="button-mapping-item">
                          <label htmlFor="dpad-up">Up Direction:</label>
                          <input
                            id="dpad-up"
                            type="number"
                            value={dpadButtonMapping.up}
                            onChange={(e) => setDpadButtonMapping(prev => ({ 
                              ...prev, 
                              up: parseInt(e.target.value) || 0 
                            }))}
                            min="0"
                            className="setting-input small"
                          />
                        </div>
                        <div className="button-mapping-item">
                          <label htmlFor="dpad-right">Right Direction:</label>
                          <input
                            id="dpad-right"
                            type="number"
                            value={dpadButtonMapping.right}
                            onChange={(e) => setDpadButtonMapping(prev => ({ 
                              ...prev, 
                              right: parseInt(e.target.value) || 0 
                            }))}
                            min="0"
                            className="setting-input small"
                          />
                        </div>
                        <div className="button-mapping-item">
                          <label htmlFor="dpad-down">Down Direction:</label>
                          <input
                            id="dpad-down"
                            type="number"
                            value={dpadButtonMapping.down}
                            onChange={(e) => setDpadButtonMapping(prev => ({ 
                              ...prev, 
                              down: parseInt(e.target.value) || 0 
                            }))}
                            min="0"
                            className="setting-input small"
                          />
                        </div>
                        <div className="button-mapping-item">
                          <label htmlFor="dpad-left">Left Direction:</label>
                          <input
                            id="dpad-left"
                            type="number"
                            value={dpadButtonMapping.left}
                            onChange={(e) => setDpadButtonMapping(prev => ({ 
                              ...prev, 
                              left: parseInt(e.target.value) || 0 
                            }))}
                            min="0"
                            className="setting-input small"
                          />
                        </div>
                      </div>
                      <small className="axis-help-text">
                        Each direction maps to a button index in the Joy message buttons array. 
                        Default mapping: Up=0, Right=1, Down=2, Left=3
                      </small>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toggle-specific settings section */}
          {component.type === 'toggle' && (
            <div className="settings-section">
              <h4>Toggle Settings</h4>
              
              <div className="setting-group">
                <div className="axis-config-disabled">
                  <p><strong>Toggle Component Configuration:</strong></p>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    <li>Message Type: <strong>std_msgs/Bool</strong> only</li>
                    <li>Field: <strong>data</strong> (boolean value)</li>
                    <li>Behavior: ON/OFF state toggle</li>
                    <li>Published Values: <strong>true</strong> when ON, <strong>false</strong> when OFF</li>
                  </ul>
                  <p style={{ fontStyle: 'italic', fontSize: '0.9em', color: 'var(--text-color-secondary)' }}>
                    Toggle components are designed for simple boolean control. They publish true/false values 
                    to the specified topic when toggled on or off.
                  </p>
                </div>
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
            disabled={!topic || !messageType || !!errorMessage}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};

export default ComponentSettingsModal; 