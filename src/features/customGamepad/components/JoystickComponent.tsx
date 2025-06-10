import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import type { IJoystickUpdateEvent } from 'react-joystick-component';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

interface JoystickComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const THROTTLE_INTERVAL = 100;

const JoystickComponent: React.FC<JoystickComponentProps> = ({ config, ros, isEditing, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const lastSentValues = useRef<number[]>([0, 0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Monitor container size for proper scaling
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    updateSize();
    
    const resizeObserver = new ResizeObserver(updateSize);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Get theme colors
  const getThemeColor = (variableName: string) => {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  };

  const baseColor = getThemeColor('--secondary-color') || '#6c757d';
  const stickColor = getThemeColor('--primary-color') || '#32CD32';

  const publishMessage = useCallback((values: number[]) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    // Apply range and data type settings
    const minValue = config.config?.min ?? -1;
    const maxValue = config.config?.max ?? config.config?.maxValue ?? 1;
    
    // Map input values to configured range and apply data type
    const mappedValues = values.map(value => {
      // Clamp to [-1, 1] first (joystick natural range)
      const clampedValue = Math.max(-1, Math.min(1, value));
      // Map to configured range
      const mappedValue = ((clampedValue + 1) / 2) * (maxValue - minValue) + minValue;
      // Apply data type
      return Number.isInteger(maxValue) && Number.isInteger(minValue) ? Math.round(mappedValue) : mappedValue;
    });

    let message: any;

    if (action.messageType === 'sensor_msgs/Joy') {
      // For Joy messages, update the specific axes
      const axesCount = Math.max(4, ...((config.config?.axes || ['0', '1']).map(a => parseInt(a) + 1).filter(n => !isNaN(n))));
      const axes = Array(axesCount).fill(0.0);
      const axesConfig = config.config?.axes || ['0', '1'];
      
      axesConfig.forEach((axisStr, index) => {
        const axisIndex = parseInt(axisStr);
        if (!isNaN(axisIndex) && index < mappedValues.length) {
          axes[axisIndex] = mappedValues[index];
        }
      });

      message = new ROSLIB.Message({
        header: {
          stamp: { secs: 0, nsecs: 0 },
          frame_id: ''
        },
        axes: axes,
        buttons: []
      });
    } else if (action.messageType === 'geometry_msgs/Twist') {
      // For Twist messages
      const linear = { x: 0, y: 0, z: 0 };
      const angular = { x: 0, y: 0, z: 0 };
      
      const axesConfig = config.config?.axes || ['linear.x', 'linear.y'];
      axesConfig.forEach((axis, index) => {
        if (index < mappedValues.length) {
          const parts = axis.split('.');
          if (parts.length === 2) {
            const [type, component] = parts;
            if (type === 'linear' && component in linear) {
              (linear as any)[component] = mappedValues[index];
            } else if (type === 'angular' && component in angular) {
              (angular as any)[component] = mappedValues[index];
            }
          }
        }
      });

      message = new ROSLIB.Message({
        linear,
        angular
      });
    } else if (action.messageType.includes('Float32') || action.messageType.includes('Float64')) {
      // For float messages
      message = new ROSLIB.Message({
        data: mappedValues[0] || 0
      });
    } else if (action.messageType.includes('Int32')) {
      // For integer messages
      message = new ROSLIB.Message({
        data: Math.round(mappedValues[0] || 0)
      });
    }

    if (message) {
      topicRef.current.publish(message);
      lastSentValues.current = [...values];
    }
  }, [config, isEditing]);

  const publishThrottled = useCallback(
    throttle(publishMessage, THROTTLE_INTERVAL, { leading: true, trailing: true }),
    [publishMessage]
  );

  useEffect(() => {
    if (!config.action || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action.topic || !action.messageType) return;

    topicRef.current = new ROSLIB.Topic({
      ros: ros,
      name: action.topic,
      messageType: action.messageType,
    });
    topicRef.current.advertise();

    return () => {
      // Send zero values on cleanup
      if (lastSentValues.current.some(v => v !== 0)) {
        publishThrottled.cancel();
        publishMessage([0, 0]);
      }
      topicRef.current?.unadvertise();
      topicRef.current = null;
    };
  }, [ros, config.action, publishMessage, publishThrottled, isEditing]);

  const handleMove = useCallback((event: IJoystickUpdateEvent) => {
    if (event.x === null || event.y === null || isEditing) return;
    
    const size = 100;
    const halfSize = size / 2;
    
    // Normalize to [-1, 1] range (natural joystick range)
    const x = event.x / halfSize;
    const y = event.y / halfSize;
    
    publishThrottled([x, y]);
  }, [publishThrottled, isEditing]);

  const handleStop = useCallback(() => {
    if (isEditing) return;
    publishThrottled.cancel();
    publishMessage([0, 0]);
  }, [publishMessage, publishThrottled, isEditing]);

  // Calculate optimal joystick size that fits within the grid cell
  const calculateJoystickSize = () => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { size: 100, stickSize: 40 };
    }

    // The container represents the exact grid cell size allocated to this component
    // Use the smaller dimension to ensure the joystick stays circular and fits
    const availableSize = Math.min(containerSize.width, containerSize.height);
    
    // Reserve minimal space for padding - joystick needs less padding than D-pad
    const padding = Math.max(8, availableSize * 0.08);
    const maxSize = availableSize - padding;
    
    // Set minimum size for usability but prioritize fitting within grid cell
    const minSize = Math.min(50, maxSize);
    const size = Math.max(minSize, maxSize);
    
    // Calculate stick size as a proportion of the base size
    const stickRatio = 0.4;
    const stickSize = Math.max(16, Math.floor(size * stickRatio));
    
    return { size, stickSize };
  };

  const { size: joystickSize, stickSize } = calculateJoystickSize();

  // Container style that centers the joystick and maintains aspect ratio
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible', // Allow joystick movement outside bounds
    boxSizing: 'border-box'
  };

  return (
    <div className="joystick-component" ref={containerRef} style={containerStyle}>
      <Joystick
        size={joystickSize}
        stickSize={stickSize}
        baseColor={config.style?.color || baseColor}
        stickColor={stickColor}
        move={handleMove}
        stop={handleStop}
        throttle={THROTTLE_INTERVAL / 2}
        disabled={isEditing}
      />
    </div>
  );
};

export default JoystickComponent; 