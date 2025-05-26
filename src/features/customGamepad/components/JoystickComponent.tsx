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
}

const THROTTLE_INTERVAL = 100;

const JoystickComponent: React.FC<JoystickComponentProps> = ({ config, ros, isEditing }) => {
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

  const size = config.style?.size === 'small' ? 60 : config.style?.size === 'large' ? 120 : 80;
  const stickSize = Math.floor(size * 0.6);

  return (
    <div className="joystick-component">
      <Joystick
        size={size}
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