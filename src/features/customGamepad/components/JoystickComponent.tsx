import React, { useEffect, useRef, useCallback } from 'react';
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

    let message: any;

    if (action.messageType === 'sensor_msgs/Joy') {
      // For Joy messages, update the specific axes
      const axes = Array(4).fill(0.0);
      const axesConfig = config.config?.axes || ['0', '1'];
      
      axesConfig.forEach((axisStr, index) => {
        const axisIndex = parseInt(axisStr);
        if (!isNaN(axisIndex) && index < values.length) {
          axes[axisIndex] = values[index];
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
        if (index < values.length) {
          const parts = axis.split('.');
          if (parts.length === 2) {
            const [type, component] = parts;
            if (type === 'linear' && component in linear) {
              (linear as any)[component] = values[index];
            } else if (type === 'angular' && component in angular) {
              (angular as any)[component] = values[index];
            }
          }
        }
      });

      message = new ROSLIB.Message({
        linear,
        angular
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
    const maxValue = config.config?.maxValue || 1.0;
    
    const x = (event.x / halfSize) * maxValue;
    const y = (event.y / halfSize) * maxValue;
    
    publishThrottled([x, y]);
  }, [publishThrottled, config.config?.maxValue, isEditing]);

  const handleStop = useCallback(() => {
    if (isEditing) return;
    publishThrottled.cancel();
    publishMessage([0, 0]);
  }, [publishMessage, publishThrottled, isEditing]);

  // Improved sizing logic that maintains better proportions and prevents oval distortion
  const baseSize = config.style?.size === 'small' ? 100 : config.style?.size === 'large' ? 180 : 140; // Significantly increased base sizes
  
  // Enhanced scaling approach that considers screen size and maintains usability
  const isSmallScreen = scaleFactor < 0.8;
  const isTinyScreen = scaleFactor < 0.7;
  
  // Adjust minimum size based on screen size for better usability - much higher minimums
  let minSize: number;
  if (isTinyScreen) {
    minSize = 80; // Much higher minimum for very small screens
  } else if (isSmallScreen) {
    minSize = 90; // Higher minimum
  } else {
    minSize = 100; // High minimum for normal screens
  }
  
  // Calculate scaled size with improved logic - much less aggressive scaling
  const scaledSize = Math.max(minSize, Math.floor(baseSize * Math.max(0.8, scaleFactor))); // Much higher minimum scale factor
  
  // Maintain proper stick-to-base ratio for circular appearance
  const stickRatio = 0.6; // Adjusted ratio for better proportion
  const stickSize = Math.max(24, Math.floor(scaledSize * stickRatio));

  // Enhanced container style to ensure proper centering and prevent oval distortion
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    // Ensure container maintains square aspect ratio to prevent oval joysticks
    aspectRatio: '1',
    // Ensure minimum dimensions for joystick movement
    minWidth: `${scaledSize + 20}px`,
    minHeight: `${scaledSize + 20}px`,
    // Allow overflow for joystick movement
    overflow: 'visible',
    boxSizing: 'border-box'
  };

  return (
    <div className="joystick-component" style={containerStyle}>
      <Joystick
        size={scaledSize}
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