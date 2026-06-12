import React, { useState, useEffect, useMemo } from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import RangeSlider from './RangeSlider';
import ValueControl from './ValueControl';
import {
  CAMERA_MESSAGE_TYPES,
  fetchNumericFields,
  filterCameraTopics,
  filterOdometryTopics,
  isPoseStampedMessageType,
  NumericFieldOption,
  ODOMETRY_MESSAGE_TYPES,
} from '../rosMessageUtils';
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
  'geometry_msgs/PoseStamped': {
    label: 'PoseStamped',
    alternativeTypes: ['geometry_msgs/msg/PoseStamped'],
    fields: {
      'pose': { type: 'pose', label: 'Pose' }
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
  },
  'sensor_msgs/Image': {
    label: 'Image',
    alternativeTypes: ['sensor_msgs/msg/Image'],
    fields: {}
  },
  'sensor_msgs/CompressedImage': {
    label: 'Compressed Image',
    alternativeTypes: ['sensor_msgs/msg/CompressedImage'],
    fields: {}
  },
  'nav_msgs/Odometry': {
    label: 'Odometry',
    alternativeTypes: ['nav_msgs/msg/Odometry'],
    fields: {}
  },
  'sensor_msgs/JointState': {
    label: 'Joint State',
    alternativeTypes: ['sensor_msgs/msg/JointState'],
    fields: {}
  }
};

const getCanonicalMessageType = (type: string): string => {
  if (type in MESSAGE_TYPES) return type;

  const match = Object.entries(MESSAGE_TYPES).find(([, config]) =>
    (config.alternativeTypes || []).includes(type)
  );
  return match?.[0] || type;
};

const getMessageTypeConfig = (type: string) => {
  return MESSAGE_TYPES[getCanonicalMessageType(type) as keyof typeof MESSAGE_TYPES];
};

// Define allowed message types for each component type
const COMPONENT_MESSAGE_TYPES: Record<string, string[]> = {
  'joystick': ['sensor_msgs/Joy', 'geometry_msgs/Twist', 'geometry_msgs/PoseStamped', 'std_msgs/Float32', 'std_msgs/Float64', 'std_msgs/Int32'],
  'button': ['std_msgs/Bool', 'std_msgs/Int32'],
  'dpad': ['sensor_msgs/Joy'], // D-pad only supports Joy
  'toggle': ['std_msgs/Bool'], // Toggle only supports Boolean
  'slider': ['std_msgs/Float32', 'std_msgs/Float64', 'std_msgs/Int32'],
  'camera': ['sensor_msgs/Image', 'sensor_msgs/CompressedImage'],
  'plot': ['std_msgs/Float32', 'std_msgs/Float64', 'std_msgs/Int32', 'sensor_msgs/Joy', 'geometry_msgs/Twist', 'nav_msgs/Odometry', 'sensor_msgs/JointState']
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
    messageType === 'geometry_msgs/msg/Twist' ||
    isPoseStampedMessageType(messageType);
};

// Helper function to check if this is a twist message type
const isTwistMessageType = (messageType: string): boolean => {
  return messageType === 'geometry_msgs/Twist' || messageType === 'geometry_msgs/msg/Twist';
};

const isPoseStampedAxisConfigurationEnabled = (messageType: string): boolean => {
  return isPoseStampedMessageType(messageType);
};

const parsePositiveIntegerOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getDefaultCameraStreamType = (messageType: string): string =>
  messageType.includes('CompressedImage') ? 'ros_compressed' : 'mjpeg';

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

  // PoseStamped-specific settings
  const [poseStampedAxes, setPoseStampedAxes] = useState<string[]>(['position.x', 'position.y']);
  const [usePoseStampedCustomAxes, setUsePoseStampedCustomAxes] = useState(false);
  const [poseStampedFrameId, setPoseStampedFrameId] = useState('map');
  const [poseStampedReferenceMode, setPoseStampedReferenceMode] = useState<'frame' | 'odometry'>('frame');
  const [poseStampedOdometryTopic, setPoseStampedOdometryTopic] = useState('/odom');
  const [poseStampedOdometryMessageType, setPoseStampedOdometryMessageType] = useState('nav_msgs/Odometry');
  const [poseStampedUseOdometryOrientation, setPoseStampedUseOdometryOrientation] = useState(true);

  // D-pad-specific settings
  const [dpadButtonMapping, setDpadButtonMapping] = useState<Record<string, number>>({
    up: 0, right: 1, down: 2, left: 3
  });

  // Button-specific settings
  const [buttonIndex, setButtonIndex] = useState(0);
  const [momentary, setMomentary] = useState(true);

  // Camera-specific settings
  const [cameraTransport, setCameraTransport] = useState<'proxy' | 'ros'>('proxy');
  const [streamType, setStreamType] = useState('mjpeg');
  const [streamWidth, setStreamWidth] = useState('');
  const [streamHeight, setStreamHeight] = useState('');

  // Plot-specific settings
  const [plotFieldPaths, setPlotFieldPaths] = useState<string[]>(['data']);
  const [plotFieldOptions, setPlotFieldOptions] = useState<NumericFieldOption[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [timeWindowSec, setTimeWindowSec] = useState(10);
  const [autoScale, setAutoScale] = useState(true);
  const [minY, setMinY] = useState(-1);
  const [maxY, setMaxY] = useState(1);

  // Heartbeat-specific settings
  const [heartbeatMode, setHeartbeatMode] = useState<'boolean' | 'pulse'>('boolean');
  const [heartbeatTimeoutMs, setHeartbeatTimeoutMs] = useState(2000);
  const [heartbeatFieldPath, setHeartbeatFieldPath] = useState('data');

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
      const messageConfig = getMessageTypeConfig(messageType);
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

      // Set defaults for new components first
      let defaultTopic = `/${component.type}`;
      let defaultMessageType = 'sensor_msgs/Joy';
      let defaultField = 'axes';

      switch (component.type) {
        case 'dpad':
          defaultTopic = '/dpad';
          defaultMessageType = 'sensor_msgs/Joy';
          defaultField = 'buttons';
          break;
        case 'slider':
          defaultTopic = '/slider';
          defaultMessageType = 'std_msgs/Float32';
          defaultField = 'data';
          break;
        case 'button':
          defaultTopic = '/button';
          defaultMessageType = 'std_msgs/Bool';
          defaultField = 'data';
          break;
        case 'toggle':
          defaultTopic = '/toggle';
          defaultMessageType = 'std_msgs/Bool';
          defaultField = 'data';
          break;
        case 'joystick':
          defaultTopic = '/joystick';
          defaultMessageType = 'sensor_msgs/Joy';
          defaultField = 'axes';
          break;
        case 'camera':
          defaultTopic = '/camera/image_raw/compressed';
          defaultMessageType = 'sensor_msgs/CompressedImage';
          defaultField = '';
          break;
        case 'plot':
          defaultTopic = '/plot';
          defaultMessageType = 'std_msgs/Float32';
          defaultField = 'data';
          break;
        case 'heartbeat':
          defaultTopic = '/heartbeat';
          defaultMessageType = 'std_msgs/Bool';
          defaultField = 'data';
          break;
      }

      // Set topic, message type, and field from action if it exists, otherwise use defaults
      setTopic((action?.topic && action.topic.trim() !== '') ? action.topic : defaultTopic);
      setMessageType(action?.messageType || defaultMessageType);
      setField(action?.field || defaultField);

      // Force component-specific message type restrictions for existing configs
      if (action) {
        if (component.type === 'dpad') {
          setMessageType(action.messageType || 'sensor_msgs/Joy');
          setField('buttons');
        } else if (component.type === 'joystick' && isPoseStampedMessageType(action.messageType || '')) {
          setMessageType(action.messageType);
          setField('pose');
        } else if (component.type === 'toggle') {
          const validToggleType = ['std_msgs/Bool', 'std_msgs/msg/Bool'].includes(action.messageType || '')
            ? action.messageType
            : 'std_msgs/Bool';
          setMessageType(validToggleType);
          setField('data');
        }
      }

      setValueRange({ min: -1, max: 1 });
      setSliderMin(-1);
      setSliderMax(1);
      setAxisSelection('xy');
      setCustomAxes(['0', '1']);
      setUseCustomAxes(false);
      setTwistAxes(['linear.x', 'linear.y']);
      setUseTwistCustomAxes(false);
      setPoseStampedAxes(['position.x', 'position.y']);
      setUsePoseStampedCustomAxes(false);
      setPoseStampedFrameId('map');
      setPoseStampedReferenceMode('frame');
      setPoseStampedOdometryTopic('/odom');
      setPoseStampedOdometryMessageType('nav_msgs/Odometry');
      setPoseStampedUseOdometryOrientation(true);
      setDpadButtonMapping({ up: 0, right: 1, down: 2, left: 3 });
      setButtonIndex(0);
      setMomentary(true);
      setHeartbeatMode('boolean');
      setHeartbeatTimeoutMs(2000);
      setHeartbeatFieldPath(action?.field || 'data');

      // Initialize component-specific settings
      if (component.config) {
        if (component.type === 'joystick') {
          const min = component.config.min ?? -1;
          const max = component.config.max ?? 1;

          const inferredStep = getInferredDataType(action?.messageType || 'sensor_msgs/Joy', action?.field || 'axes') === 'float' ? 0.1 : 1;
          const minPrecision = getPrecision(inferredStep);

          setValueRange({
            min: parseFloat(min.toFixed(minPrecision)),
            max: parseFloat(max.toFixed(minPrecision))
          });
          setSliderMin(parseFloat((component.config.sliderMin ?? min).toFixed(minPrecision)));
          setSliderMax(parseFloat((component.config.sliderMax ?? max).toFixed(minPrecision)));

          if (component.config.axes) {
            const axes = component.config.axes;

            if (isPoseStampedMessageType(action?.messageType || '')) {
              setPoseStampedAxes(axes);
              const standardPoseCombos = [
                ['position.x', 'position.y'],
                ['position.y', 'position.z'],
                ['position.x', 'position.z']
              ];
              const isStandardCombo = standardPoseCombos
                .some(combo => combo.length === axes.length && combo.every((axis, index) => axis === axes[index]));
              setUsePoseStampedCustomAxes(!isStandardCombo);
            } else if (isTwistMessageType(action?.messageType || '')) {
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

          setPoseStampedFrameId(component.config.poseStampedFrameId || 'map');
          setPoseStampedReferenceMode(component.config.poseStampedReferenceMode || 'frame');
          setPoseStampedOdometryTopic(component.config.poseStampedOdometryTopic || '/odom');
          setPoseStampedOdometryMessageType(component.config.poseStampedOdometryMessageType || 'nav_msgs/Odometry');
          setPoseStampedUseOdometryOrientation(component.config.poseStampedUseOdometryOrientation !== false);
        } else if (component.type === 'button') {
          setButtonIndex(component.config.buttonIndex ?? 0);
          setMomentary(component.config.momentary ?? true);
        } else if (component.type === 'dpad') {
          // Initialize D-pad button mapping
          setDpadButtonMapping(component.config.buttonMapping || {
            up: 0, right: 1, down: 2, left: 3
          });
        } else if (component.type === 'camera') {
          setCameraTransport(component.config.cameraTransport ?? 'proxy');
          setStreamType(component.config.streamType ?? getDefaultCameraStreamType(action?.messageType || defaultMessageType));
          setStreamWidth(component.config.streamWidth ? String(component.config.streamWidth) : '');
          setStreamHeight(component.config.streamHeight ? String(component.config.streamHeight) : '');
        } else if (component.type === 'plot') {
          const plotFields = component.config.fieldPaths?.length
            ? component.config.fieldPaths
            : [component.config.fieldPath || action?.field || 'data'];
          setPlotFieldPaths(plotFields);
          setTimeWindowSec(component.config.timeWindowSec ?? 10);
          setAutoScale(component.config.autoScale !== false);
          setMinY(component.config.minY ?? -1);
          setMaxY(component.config.maxY ?? 1);
        } else if (component.type === 'heartbeat') {
          setHeartbeatMode(component.config.heartbeatMode ?? 'boolean');
          setHeartbeatTimeoutMs(component.config.heartbeatTimeoutMs ?? 2000);
          setHeartbeatFieldPath(component.config.heartbeatFieldPath || action?.field || 'data');
        }
      }
    }
  }, [component]);

  useEffect(() => {
    if (!isOpen || component?.type !== 'plot' || !ros || !ros.isConnected || !messageType) {
      setPlotFieldOptions([]);
      return;
    }

    let cancelled = false;
    setIsLoadingFields(true);
    fetchNumericFields(ros, messageType).then(fields => {
      if (cancelled) return;
      setPlotFieldOptions(fields);
      if (fields.length > 0 && plotFieldPaths.every(path => !fields.some(option => option.path === path))) {
        setPlotFieldPaths([fields[0].path]);
      }
      setIsLoadingFields(false);
    });

    return () => {
      cancelled = true;
    };
  }, [component?.type, isOpen, messageType, plotFieldPaths, ros]);

  const inferredDataType = useMemo(() => getInferredDataType(messageType, field), [messageType, field]);

  // Get available topics filtered by message type
  const filteredTopics = useMemo(() => {
    if (component?.type === 'camera') {
      return filterCameraTopics(availableTopics);
    }

    if (component?.type === 'plot' || component?.type === 'heartbeat') {
      return availableTopics.filter(topicInfo =>
        topicInfo.type && !topicInfo.name.includes('/_action/') && !topicInfo.name.includes('/parameter_events')
      );
    }

    if (!messageType) return availableTopics;

    // Get the message type configuration
    const messageConfig = getMessageTypeConfig(messageType);
    if (!messageConfig) return [];

    // Create a list of all possible type formats to match against
    const typesToMatch = [messageType, ...(messageConfig.alternativeTypes || [])];

    const filtered = availableTopics.filter(topic =>
      typesToMatch.some(typeToMatch => topic.type === typeToMatch)
    );

    return filtered;
  }, [availableTopics, component?.type, messageType]);

  const odometryTopics = useMemo(() => filterOdometryTopics(availableTopics), [availableTopics]);

  // Get available fields for the selected message type
  const availableFields = useMemo(() => {
    const messageConfig = getMessageTypeConfig(messageType);
    if (!messageType || !messageConfig) {
      return {};
    }
    return messageConfig.fields;
  }, [messageType]);

  // Get allowed message types for the current component type
  const allowedMessageTypes = useMemo(() => {
    if (!component) return [];
    if (component.type === 'heartbeat') {
      return Array.from(new Set([
        'std_msgs/Bool',
        'std_msgs/Int32',
        'std_msgs/String',
        ...availableTopics.map(topicInfo => getCanonicalMessageType(topicInfo.type)).filter(Boolean),
      ]));
    }
    return COMPONENT_MESSAGE_TYPES[component.type] || [];
  }, [availableTopics, component?.type]);

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

    if (component.type === 'camera' && !CAMERA_MESSAGE_TYPES.includes(messageType)) {
      setErrorMessage('Camera components can only use Image or CompressedImage message types.');
      return;
    }

    if (component.type === 'joystick' && isPoseStampedMessageType(messageType)) {
      if (poseStampedReferenceMode === 'frame' && !poseStampedFrameId.trim()) {
        setErrorMessage('PoseStamped joystick output needs a frame ID.');
        return;
      }
      if (poseStampedReferenceMode === 'odometry' && !poseStampedOdometryTopic.trim()) {
        setErrorMessage('PoseStamped odometry offset mode needs an odometry topic.');
        return;
      }
    }

    const selectedPlotFields = plotFieldPaths.map(path => path.trim()).filter(Boolean);

    if (component.type === 'plot' && selectedPlotFields.length === 0) {
      setErrorMessage('Plot components need a numeric field path.');
      return;
    }

    if (component.type === 'heartbeat' && heartbeatMode === 'boolean' && !heartbeatFieldPath.trim()) {
      setErrorMessage('Boolean heartbeat mode needs a field path.');
      return;
    }

    const dataType = getInferredDataType(messageType, field);
    const precision = getPrecision(dataType === 'float' ? 0.1 : 1);

    // Build the updated configuration
    const action: ROSTopicConfig = {
      topic,
      messageType,
      field: component.type === 'plot'
        ? selectedPlotFields[0]
        : component.type === 'heartbeat' && heartbeatMode === 'boolean'
          ? heartbeatFieldPath.trim()
        : (component.type === 'joystick' && isPoseStampedMessageType(messageType) ? 'pose' : (field || undefined))
    };

    let updatedConfig = { ...component.config };

    // Add component-specific configuration
    if (component.type === 'joystick') {
      let axesToUse: string[];

      if (isPoseStampedMessageType(messageType)) {
        axesToUse = usePoseStampedCustomAxes ? poseStampedAxes : poseStampedAxes;
      } else if (isTwistMessageType(messageType)) {
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
        axes: axesToUse,
        poseStampedFrameId: isPoseStampedMessageType(messageType) && poseStampedFrameId.trim()
          ? poseStampedFrameId.trim()
          : undefined,
        poseStampedReferenceMode: isPoseStampedMessageType(messageType) ? poseStampedReferenceMode : undefined,
        poseStampedOdometryTopic: isPoseStampedMessageType(messageType) && poseStampedReferenceMode === 'odometry'
          ? poseStampedOdometryTopic.trim()
          : undefined,
        poseStampedOdometryMessageType: isPoseStampedMessageType(messageType) && poseStampedReferenceMode === 'odometry'
          ? poseStampedOdometryMessageType
          : undefined,
        poseStampedUseOdometryOrientation: isPoseStampedMessageType(messageType) && poseStampedReferenceMode === 'odometry'
          ? poseStampedUseOdometryOrientation
          : undefined
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
    } else if (component.type === 'camera') {
      updatedConfig = {
        ...updatedConfig,
        cameraTransport,
        streamType: streamType || getDefaultCameraStreamType(messageType),
        streamWidth: parsePositiveIntegerOrUndefined(streamWidth),
        streamHeight: parsePositiveIntegerOrUndefined(streamHeight)
      };
    } else if (component.type === 'plot') {
      updatedConfig = {
        ...updatedConfig,
        fieldPath: selectedPlotFields[0],
        fieldPaths: selectedPlotFields,
        timeWindowSec: Math.max(1, timeWindowSec),
        autoScale,
        minY,
        maxY
      };
    } else if (component.type === 'heartbeat') {
      updatedConfig = {
        ...updatedConfig,
        heartbeatMode,
        heartbeatTimeoutMs: Math.max(100, heartbeatTimeoutMs),
        heartbeatFieldPath: heartbeatMode === 'boolean' ? heartbeatFieldPath.trim() : undefined
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

  const handlePlotFieldToggle = (path: string, checked: boolean) => {
    setPlotFieldPaths(previous => {
      const next = checked
        ? Array.from(new Set([...previous, path]))
        : previous.filter(item => item !== path);
      return next.length > 0 ? next : [path];
    });
  };

  const handlePlotFieldTextChange = (value: string) => {
    const paths = value.split(',').map(path => path.trim()).filter(Boolean);
    const nextPaths = paths.length > 0 ? paths : [''];
    setPlotFieldPaths(nextPaths);
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
              {component.type === 'heartbeat' ? (
                <>
                  <input
                    id="message-type"
                    type="text"
                    list="heartbeat-message-types"
                    value={messageType}
                    onChange={(e) => setMessageType(e.target.value)}
                    placeholder="e.g. std_msgs/msg/Bool"
                    className="setting-input"
                  />
                  <datalist id="heartbeat-message-types">
                    {allowedMessageTypes.map(type => <option key={type} value={type} />)}
                  </datalist>
                  <small className="axis-help-text">
                    Heartbeats accept any ROS message type. Selecting an existing topic fills this automatically.
                  </small>
                </>
              ) : (
                <select
                id="message-type"
                value={messageType}
                onChange={(e) => {
                  const newMessageType = e.target.value;
                  setMessageType(newMessageType);
                  if (component?.type === 'camera') {
                    setStreamType(getDefaultCameraStreamType(newMessageType));
                  }
                  // Auto-set field for restricted components
                  if (component?.type === 'toggle' && newMessageType.includes('Bool')) {
                    setField('data');
                  } else if (component?.type === 'dpad' && newMessageType.includes('Joy')) {
                    setField('buttons');
                  } else if (component?.type === 'joystick' && isPoseStampedMessageType(newMessageType)) {
                    setField('pose');
                    setPoseStampedAxes(['position.x', 'position.y']);
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
              )}
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
                  onChange={(e) => {
                    const nextTopic = e.target.value;
                    setTopic(nextTopic);
                    if (component.type === 'camera' || component.type === 'plot' || component.type === 'heartbeat') {
                      const selectedTopic = availableTopics.find(item => item.name === nextTopic);
                      if (selectedTopic?.type) {
                        const canonicalType = getCanonicalMessageType(selectedTopic.type);
                        setMessageType(canonicalType);
                        if (component.type === 'camera') {
                          setStreamType(getDefaultCameraStreamType(canonicalType));
                        } else if (component.type === 'heartbeat') {
                          const isBooleanType = canonicalType.endsWith('/Bool') || canonicalType.endsWith('/msg/Bool');
                          setHeartbeatMode(isBooleanType ? 'boolean' : 'pulse');
                          if (isBooleanType) setHeartbeatFieldPath('data');
                        }
                      }
                    }
                  }}
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

            {messageType && component.type !== 'plot' && component.type !== 'camera' && component.type !== 'heartbeat' && Object.keys(availableFields).length > 0 && (
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
                        {(fieldInfo as { label: string }).label} ({fieldName})
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
          {component.type === 'camera' && (
            <div className="settings-section">
              <h4>Camera Settings</h4>

              <div className="setting-group">
                <label htmlFor="camera-transport">Transport:</label>
                <select
                  id="camera-transport"
                  value={cameraTransport}
                  onChange={(e) => setCameraTransport(e.target.value as 'proxy' | 'ros')}
                  className="setting-select"
                >
                  <option value="proxy">Proxy stream (/video_stream)</option>
                  <option value="ros">ROS topic subscription</option>
                </select>
              </div>

              {cameraTransport === 'proxy' && (
                <>
                  <div className="setting-group">
                    <label htmlFor="camera-stream-type">Stream Type:</label>
                    <input
                      id="camera-stream-type"
                      type="text"
                      value={streamType}
                      onChange={(e) => setStreamType(e.target.value)}
                      placeholder="mjpeg"
                      className="setting-input"
                    />
                  </div>
                  <div className="setting-group range-controls">
                    <ValueControl
                      label="Width"
                      value={streamWidth ? Number(streamWidth) : 0}
                      onChange={(value) => setStreamWidth(value > 0 ? String(Math.round(value)) : '')}
                      step={1}
                      min={0}
                    />
                    <ValueControl
                      label="Height"
                      value={streamHeight ? Number(streamHeight) : 0}
                      onChange={(value) => setStreamHeight(value > 0 ? String(Math.round(value)) : '')}
                      step={1}
                      min={0}
                    />
                  </div>
                  <small className="axis-help-text">
                    Leave width and height at 0 to use the stream's native size.
                  </small>
                </>
              )}
            </div>
          )}

          {component.type === 'heartbeat' && (
            <div className="settings-section">
              <h4>Heartbeat Settings</h4>

              <div className="setting-group">
                <label htmlFor="heartbeat-mode">Validation Mode:</label>
                <select
                  id="heartbeat-mode"
                  value={heartbeatMode}
                  onChange={(e) => setHeartbeatMode(e.target.value as 'boolean' | 'pulse')}
                  className="setting-select"
                >
                  <option value="boolean">Boolean / status value</option>
                  <option value="pulse">Recurring message</option>
                </select>
                <small className="axis-help-text">
                  Boolean mode reflects a field value. Recurring mode is healthy while messages keep arriving.
                </small>
              </div>

              {heartbeatMode === 'boolean' ? (
                <div className="setting-group">
                  <label htmlFor="heartbeat-field-path">Status Field Path:</label>
                  <input
                    id="heartbeat-field-path"
                    type="text"
                    value={heartbeatFieldPath}
                    onChange={(e) => setHeartbeatFieldPath(e.target.value)}
                    placeholder="data or status.healthy"
                    className="setting-input"
                  />
                  <small className="axis-help-text">
                    Supports booleans, non-zero numbers, and values such as true, alive, ok, or healthy.
                  </small>
                </div>
              ) : (
                <div className="setting-group">
                  <label htmlFor="heartbeat-timeout">Stale Timeout (ms):</label>
                  <input
                    id="heartbeat-timeout"
                    type="number"
                    min="100"
                    step="100"
                    value={heartbeatTimeoutMs}
                    onChange={(e) => setHeartbeatTimeoutMs(Number(e.target.value) || 100)}
                    className="setting-input"
                  />
                </div>
              )}
            </div>
          )}

          {component.type === 'plot' && (
            <div className="settings-section">
              <h4>Plot Settings</h4>

              <div className="setting-group">
                <label htmlFor="plot-field-custom">Numeric Fields:</label>
                {plotFieldOptions.length > 0 && (
                  <div className="plot-field-options" aria-label="Numeric fields">
                    {plotFieldOptions.map(option => (
                      <label key={option.path} className="checkbox-label compact">
                        <input
                          type="checkbox"
                          checked={plotFieldPaths.includes(option.path)}
                          onChange={(e) => handlePlotFieldToggle(option.path, e.target.checked)}
                          disabled={isLoadingFields}
                        />
                        <span>{option.label} ({option.rosType})</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="topic-input-group">
                  <input
                    id="plot-field-custom"
                    type="text"
                    value={plotFieldPaths.join(', ')}
                    onChange={(e) => handlePlotFieldTextChange(e.target.value)}
                    placeholder="linear.x, angular.z"
                    className="setting-input topic-input"
                  />
                </div>
                {messageType && plotFieldOptions.length === 0 && !isLoadingFields && (
                  <div className="topic-warning">
                    No numeric fields were discovered. Enter one or more comma-separated field paths manually.
                  </div>
                )}
              </div>

              <div className="setting-group range-controls">
                <ValueControl
                  label="Time Window (s)"
                  value={timeWindowSec}
                  onChange={setTimeWindowSec}
                  step={1}
                  min={1}
                />
              </div>

              <div className="setting-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoScale}
                    onChange={(e) => setAutoScale(e.target.checked)}
                  />
                  Auto-scale Y axis
                </label>
              </div>

              {!autoScale && (
                <div className="setting-group range-controls">
                  <ValueControl
                    label="Y Min"
                    value={minY}
                    onChange={setMinY}
                    step={0.1}
                    max={maxY}
                  />
                  <ValueControl
                    label="Y Max"
                    value={maxY}
                    onChange={setMaxY}
                    step={0.1}
                    min={minY}
                  />
                </div>
              )}
            </div>
          )}

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

              {/* Only show axis configuration for Joy, Twist, and PoseStamped message types */}
              {isAxisConfigurationEnabled(messageType) && (
                <div className="setting-group">
                  <label>Axis Configuration:</label>
                  <div className="axis-config">
                    {isPoseStampedAxisConfigurationEnabled(messageType) ? (
                      <>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={usePoseStampedCustomAxes}
                            onChange={(e) => setUsePoseStampedCustomAxes(e.target.checked)}
                          />
                          Use custom pose mapping
                        </label>

                        {!usePoseStampedCustomAxes && (
                          <div className="axis-selection">
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="position.x,position.y"
                                checked={poseStampedAxes.join(',') === 'position.x,position.y'}
                                onChange={() => setPoseStampedAxes(['position.x', 'position.y'])}
                              />
                              Position X and Y
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="position.y,position.z"
                                checked={poseStampedAxes.join(',') === 'position.y,position.z'}
                                onChange={() => setPoseStampedAxes(['position.y', 'position.z'])}
                              />
                              Position Y and Z
                            </label>
                            <label className="radio-label">
                              <input
                                type="radio"
                                value="position.x,position.z"
                                checked={poseStampedAxes.join(',') === 'position.x,position.z'}
                                onChange={() => setPoseStampedAxes(['position.x', 'position.z'])}
                              />
                              Position X and Z
                            </label>
                          </div>
                        )}

                        {usePoseStampedCustomAxes && (
                          <div className="custom-axes">
                            <label htmlFor="pose-stamped-custom-axes-input">Custom Pose Axes (comma-separated):</label>
                            <input
                              id="pose-stamped-custom-axes-input"
                              type="text"
                              value={poseStampedAxes.join(', ')}
                              onChange={(e) => setPoseStampedAxes(e.target.value.split(',').map(s => s.trim()).filter(s => s))}
                              placeholder="position.x, position.y"
                              className="setting-input"
                            />
                            <small className="axis-help-text">
                              Available: position.x, position.y, position.z
                            </small>
                          </div>
                        )}
                      </>
                    ) : isTwistMessageType(messageType) ? (
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

              {isPoseStampedMessageType(messageType) && (
                <div className="setting-group">
                  <label>Pose Reference:</label>
                  <div className="axis-config">
                    <div className="setting-group">
                      <label htmlFor="pose-stamped-frame-id">Output Frame ID:</label>
                      <input
                        id="pose-stamped-frame-id"
                        type="text"
                        value={poseStampedFrameId}
                        onChange={(e) => setPoseStampedFrameId(e.target.value)}
                        placeholder="map"
                        className="setting-input"
                      />
                      {poseStampedReferenceMode === 'odometry' && (
                        <small className="axis-help-text">
                          Leave blank to publish in the latest odometry frame.
                        </small>
                      )}
                    </div>

                    <div className="axis-selection">
                      <label className="radio-label">
                        <input
                          type="radio"
                          value="frame"
                          checked={poseStampedReferenceMode === 'frame'}
                          onChange={() => {
                            setPoseStampedReferenceMode('frame');
                            if (!poseStampedFrameId.trim()) {
                              setPoseStampedFrameId('map');
                            }
                          }}
                        />
                        Publish joystick pose in this frame
                      </label>
                      <label className="radio-label">
                        <input
                          type="radio"
                          value="odometry"
                          checked={poseStampedReferenceMode === 'odometry'}
                          onChange={() => {
                            setPoseStampedReferenceMode('odometry');
                            if (poseStampedFrameId === 'map') {
                              setPoseStampedFrameId('');
                            }
                          }}
                        />
                        Add joystick offset to odometry pose
                      </label>
                    </div>

                    {poseStampedReferenceMode === 'odometry' && (
                      <>
                        <div className="setting-group">
                          <label htmlFor="pose-stamped-odom-topic">Odometry Topic:</label>
                          <div className="topic-input-group">
                            <select
                              id="pose-stamped-odom-topic"
                              value={poseStampedOdometryTopic}
                              onChange={(e) => {
                                const nextTopic = e.target.value;
                                setPoseStampedOdometryTopic(nextTopic);
                                const selectedTopic = odometryTopics.find(item => item.name === nextTopic);
                                if (selectedTopic?.type) {
                                  setPoseStampedOdometryMessageType(selectedTopic.type);
                                }
                              }}
                              className="setting-select topic-select"
                              disabled={isLoadingTopics}
                            >
                              <option value="">
                                {isLoadingTopics ? 'Loading topics...' : 'Select odometry topic...'}
                              </option>
                              {odometryTopics.map(topicInfo => (
                                <option key={topicInfo.name} value={topicInfo.name}>
                                  {topicInfo.name} ({topicInfo.type})
                                </option>
                              ))}
                              {odometryTopics.length === 0 && (
                                <option disabled>No odometry topics found</option>
                              )}
                            </select>
                            <span className="topic-input-separator">or</span>
                            <input
                              type="text"
                              value={poseStampedOdometryTopic}
                              onChange={(e) => setPoseStampedOdometryTopic(e.target.value)}
                              placeholder="/odom"
                              className="setting-input topic-input"
                            />
                          </div>
                        </div>

                        <div className="setting-group">
                          <label htmlFor="pose-stamped-odom-message-type">Odometry Message Type:</label>
                          <select
                            id="pose-stamped-odom-message-type"
                            value={poseStampedOdometryMessageType}
                            onChange={(e) => setPoseStampedOdometryMessageType(e.target.value)}
                            className="setting-select"
                          >
                            {ODOMETRY_MESSAGE_TYPES.map(type => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </div>

                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={poseStampedUseOdometryOrientation}
                            onChange={(e) => setPoseStampedUseOdometryOrientation(e.target.checked)}
                          />
                          Use odometry orientation
                        </label>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Show message when axis configuration is disabled */}
              {!isAxisConfigurationEnabled(messageType) && messageType && (
                <div className="setting-group">
                  <div className="axis-config-disabled">
                    <p>Axis configuration is only available for Joy, Twist, and PoseStamped message types.</p>
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
