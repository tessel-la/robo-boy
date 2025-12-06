import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { Joystick } from 'react-joystick-component';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

// Define the joystick update event interface locally since it's not exported from the library
interface IJoystickUpdateEvent {
  type: 'move' | 'stop' | 'start';
  x: number | null;
  y: number | null;
  direction: string | null;
  distance: number | null;
}

interface JoystickComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const THROTTLE_INTERVAL = 100;

const JoystickComponent: React.FC<JoystickComponentProps> = ({ config, ros, isEditing, scaleFactor: _scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const lastSentValues = useRef<number[]>([0, 0]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const joystickSizeRef = useRef(100); // Use ref to hold joystick size
  const [baseColor, setBaseColor] = useState<string>('#6c757d');
  const [stickColor, setStickColor] = useState<string>('#32CD32');

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

  // Make joystick colors reactive to theme changes
  useEffect(() => {
    const updateJoystickColors = () => {
      const baseThemeColor = getThemeColor('--secondary-color') || '#6c757d';
      const stickThemeColor = getThemeColor('--primary-color') || '#32CD32';
      setBaseColor(baseThemeColor);
      setStickColor(stickThemeColor);
    };

    // Update colors initially
    updateJoystickColors();

    // Watch for theme changes by observing data-theme attribute changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          updateJoystickColors();
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, []);

  // Calculate optimal joystick size that fits within the grid cell
  const calculateJoystickSize = () => {
    let size, stickSize;
    if (containerSize.width === 0 || containerSize.height === 0) {
      size = 100;
      stickSize = 40;
    } else {
      // The container represents the exact grid cell size allocated to this component
      // Use the smaller dimension to ensure the joystick stays circular and fits
      const availableSize = Math.min(containerSize.width, containerSize.height);

      // Reserve minimal space for padding
      const padding = Math.max(8, availableSize * 0.08);
      const maxSize = availableSize - padding;

      // Set minimum size for usability, but scale it down for editing mode
      const minSize = isEditing ? Math.min(30, maxSize) : Math.min(50, maxSize);
      size = Math.max(minSize, maxSize);

      // Calculate stick size as a proportion of the base size
      const stickRatio = 0.4;
      const minStickSize = isEditing ? 4 : 12;
      stickSize = Math.max(minStickSize, Math.floor(size * stickRatio));
    }
    joystickSizeRef.current = size; // Update ref
    return { size, stickSize };
  };

  const { size: joystickSize, stickSize } = calculateJoystickSize();

  const publishMessage = useCallback((values: number[]) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    // Get range settings - use default joystick range if not configured
    const minValue = config.config?.min;
    const maxValue = config.config?.max ?? config.config?.maxValue;

    // Only apply range mapping if custom range is explicitly set
    const mappedValues = (minValue !== undefined && maxValue !== undefined) ?
      values.map(value => {
        // Clamp to [-1, 1] first (joystick natural range)
        const clampedValue = Math.max(-1, Math.min(1, value));
        // Map to configured range. Rounding is now handled based on the message type,
        // not the range configuration, allowing for float outputs.
        return ((clampedValue + 1) / 2) * (maxValue - minValue) + minValue;
      }) :
      values; // Use raw joystick values [-1, 1] when no custom range is set

    // Debug logging
    console.log('Joystick values:', values);
    console.log('Config range:', { min: minValue, max: maxValue });
    console.log('Mapped values:', mappedValues);
    console.log('Topic:', action.topic, 'Type:', action.messageType);

    let message: any;

    if (action.messageType === 'sensor_msgs/Joy' || action.messageType === 'sensor_msgs/msg/Joy') {
      // For Joy messages, update the specific axes
      const axesConfig = config.config?.axes || ['0', '1'];
      const maxAxisIndex = Math.max(...axesConfig.map(a => parseInt(a)).filter(n => !isNaN(n)));
      const axesCount = Math.max(4, maxAxisIndex + 1); // Ensure enough axes
      const axes = Array(axesCount).fill(0.0);

      axesConfig.forEach((axisStr, index) => {
        const axisIndex = parseInt(axisStr);
        if (!isNaN(axisIndex) && index < mappedValues.length && axisIndex < axes.length) {
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
    } else if (action.messageType === 'geometry_msgs/Twist' || action.messageType === 'geometry_msgs/msg/Twist') {
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
      console.log('Publishing message:', message);
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
    if (event.x === null || event.y === null || event.distance === null || isEditing) return;

    // Debug: Log raw joystick component values
    console.log('Raw joystick event:', {
      x: event.x,
      y: event.y,
      distance: event.distance,
      direction: event.direction
    });

    // Use distance (0-100) from the event to ensure correct scaling.
    const magnitude = event.distance / 100; // Normalize distance to 0-1.

    if (magnitude === 0) {
      publishThrottled([0, 0]);
      return;
    }

    // atan2 gets the angle from the raw x/y pixel values. 
    // Y is not inverted here, so that moving the joystick up results in a positive Y value.
    const angleRad = Math.atan2(event.y, event.x);

    // Reconstruct the normalized x and y from the magnitude and angle.
    const x = magnitude * Math.cos(angleRad);
    const y = magnitude * Math.sin(angleRad);

    console.log('Calculated normalized values:', {
      magnitude,
      angleRad,
      normalizedX: x,
      normalizedY: y
    });

    publishThrottled([x, y]);
  }, [publishThrottled, isEditing]);

  const handleStop = useCallback(() => {
    if (isEditing) return;
    publishThrottled.cancel();
    publishMessage([0, 0]);
  }, [publishMessage, publishThrottled, isEditing]);

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