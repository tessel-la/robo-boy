import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

interface ToggleComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const ToggleComponent: React.FC<ToggleComponentProps> = ({ config, ros, isEditing, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const [isOn, setIsOn] = useState(false);

  const publishMessage = useCallback((state: boolean) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    let message: any;

    if (action.messageType === 'std_msgs/Bool') {
      message = new ROSLIB.Message({
        data: state
      });
    } else if (action.messageType === 'std_msgs/Int32') {
      message = new ROSLIB.Message({
        data: state ? 1 : 0
      });
    }

    if (message) {
      topicRef.current.publish(message);
    }
  }, [config, isEditing]);

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

  const handleToggle = useCallback(() => {
    if (isEditing) return;
    
    const newState = !isOn;
    setIsOn(newState);
    publishMessage(newState);
  }, [isOn, publishMessage, isEditing]);

  const toggleStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: `${Math.max(4, 8 * scaleFactor)}px`,
    opacity: isEditing ? 0.7 : 1
  };

  const switchStyle: React.CSSProperties = {
    width: `${Math.floor(60 * scaleFactor)}px`,
    height: `${Math.floor(30 * scaleFactor)}px`,
    backgroundColor: isOn ? (config.style?.color || 'var(--primary-color)') : 'var(--secondary-color)',
    borderRadius: `${Math.floor(15 * scaleFactor)}px`,
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid ${isOn ? (config.style?.color || 'var(--primary-color)') : 'var(--border-color)'}`,
    cursor: isEditing ? 'default' : 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    padding: `${Math.floor(2 * scaleFactor)}px`
  };

  const knobStyle: React.CSSProperties = {
    width: `${Math.floor(22 * scaleFactor)}px`,
    height: `${Math.floor(22 * scaleFactor)}px`,
    backgroundColor: 'white',
    borderRadius: '50%',
    transition: 'transform 0.2s ease',
    transform: isOn ? `translateX(${Math.floor(30 * scaleFactor)}px)` : 'translateX(0px)',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
  };

  const labelStyle: React.CSSProperties = {
    fontSize: `${0.9 * scaleFactor}em`,
    fontWeight: 'bold',
    color: 'var(--text-color)',
    textAlign: 'center'
  };

  return (
    <div className="toggle-component" style={toggleStyle}>
      {config.label && (
        <div style={labelStyle}>
          {config.label}
        </div>
      )}
      <div 
        className={`toggle-switch ${isOn ? 'on' : 'off'}`}
        style={switchStyle}
        onClick={handleToggle}
      >
        <div className="toggle-knob" style={knobStyle} />
      </div>
      <div style={{ fontSize: `${0.8 * scaleFactor}em`, color: 'var(--text-color-secondary)' }}>
        {isOn ? 'ON' : 'OFF'}
      </div>
    </div>
  );
};

export default ToggleComponent; 