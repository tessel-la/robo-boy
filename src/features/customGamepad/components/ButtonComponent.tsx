import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

interface ButtonComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const THROTTLE_INTERVAL = 100;

const ButtonComponent: React.FC<ButtonComponentProps> = ({ config, ros, isEditing, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [toggleState, setToggleState] = useState(false);

  const publishMessage = useCallback((pressed: boolean) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    let message: any;

    if (action.messageType === 'sensor_msgs/Joy') {
      const buttons = Array(8).fill(0);
      const buttonIndex = config.config?.buttonIndex || 0;
      buttons[buttonIndex] = pressed ? 1 : 0;

      message = new ROSLIB.Message({
        header: {
          stamp: { secs: 0, nsecs: 0 },
          frame_id: ''
        },
        axes: [],
        buttons: buttons
      });
    } else if (action.messageType === 'std_msgs/Bool') {
      message = new ROSLIB.Message({
        data: pressed
      });
    } else if (action.messageType === 'std_msgs/Int32') {
      message = new ROSLIB.Message({
        data: pressed ? 1 : 0
      });
    }

    if (message) {
      topicRef.current.publish(message);
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
      topicRef.current?.unadvertise();
      topicRef.current = null;
    };
  }, [ros, config.action, isEditing]);

  const handlePointerDown = useCallback(() => {
    if (isEditing) return;

    const isMomentary = config.config?.momentary !== false;
    
    if (isMomentary) {
      setIsPressed(true);
      publishThrottled(true);
    } else {
      // Toggle behavior
      const newState = !toggleState;
      setToggleState(newState);
      publishThrottled(newState);
    }
  }, [config.config?.momentary, toggleState, publishThrottled, isEditing]);

  const handlePointerUp = useCallback(() => {
    if (isEditing) return;

    const isMomentary = config.config?.momentary !== false;
    
    if (isMomentary) {
      setIsPressed(false);
      publishThrottled(false);
    }
    // For toggle buttons, we don't do anything on pointer up
  }, [config.config?.momentary, publishThrottled, isEditing]);

  const handlePointerLeave = useCallback(() => {
    if (isEditing) return;

    const isMomentary = config.config?.momentary !== false;
    
    if (isMomentary && isPressed) {
      setIsPressed(false);
      publishThrottled(false);
    }
  }, [config.config?.momentary, isPressed, publishThrottled, isEditing]);

  const isMomentary = config.config?.momentary !== false;
  const isActive = isMomentary ? isPressed : toggleState;
  const size = config.style?.size || 'medium';
  const color = config.style?.color;

  const baseFontSize = size === 'small' ? 0.8 : size === 'large' ? 1.2 : 1;
  const basePadding = size === 'small' ? 4 : size === 'large' ? 12 : 8;
  
  const buttonStyle: React.CSSProperties = {
    backgroundColor: isActive ? (color || 'var(--primary-color)') : 'var(--secondary-color)',
    color: isActive ? 'white' : 'var(--text-color)',
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid ${isActive ? (color || 'var(--primary-color)') : 'var(--border-color)'}`,
    borderRadius: `${Math.floor(8 * scaleFactor)}px`,
    padding: `${Math.floor(basePadding * scaleFactor)}px ${Math.floor(basePadding * 2 * scaleFactor)}px`,
    fontSize: `${baseFontSize * scaleFactor}em`,
    fontWeight: 'bold',
    cursor: isEditing ? 'default' : 'pointer',
    userSelect: 'none',
    transition: 'all 0.1s ease',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: isEditing ? 0.7 : 1
  };

  return (
    <button
      className={`button-component ${isMomentary ? 'momentary' : 'toggle'} ${isActive ? 'active' : ''}`}
      style={buttonStyle}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      disabled={isEditing}
    >
      {config.label || 'Button'}
    </button>
  );
};

export default ButtonComponent; 