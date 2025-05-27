import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';

interface DPadComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  scaleFactor?: number;
}

const THROTTLE_INTERVAL = 100;

const DPadComponent: React.FC<DPadComponentProps> = ({ config, ros, isEditing, scaleFactor = 1 }) => {
  const topicRef = useRef<Topic | null>(null);
  const [pressedDirections, setPressedDirections] = useState<Set<string>>(new Set());
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

  const publishMessage = useCallback((directions: Set<string>) => {
    if (!topicRef.current || isEditing) return;

    const action = config.action as ROSTopicConfig;
    if (!action || !action.topic) return;

    if (action.messageType === 'sensor_msgs/Joy') {
      const buttons = Array(8).fill(0);
      const buttonMapping = config.config?.buttonMapping || {
        up: 0, right: 1, down: 2, left: 3
      };

      directions.forEach(direction => {
        const buttonIndex = buttonMapping[direction];
        if (typeof buttonIndex === 'number' && buttonIndex < buttons.length) {
          buttons[buttonIndex] = 1;
        }
      });

      const message = new ROSLIB.Message({
        header: {
          stamp: { secs: 0, nsecs: 0 },
          frame_id: ''
        },
        axes: [],
        buttons: buttons
      });

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

  const handleDirectionPress = useCallback((direction: string, pressed: boolean) => {
    if (isEditing) return;

    setPressedDirections(prev => {
      const newSet = new Set(prev);
      if (pressed) {
        newSet.add(direction);
      } else {
        newSet.delete(direction);
      }
      publishThrottled(newSet);
      return newSet;
    });
  }, [publishThrottled, isEditing]);

  // Calculate optimal D-pad size that fits within the grid cell
  const calculateDPadSize = () => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { size: 120, padding: 8 };
    }

    // The container represents the exact grid cell size allocated to this component
    // We need to fit the D-pad within this exact space
    const availableWidth = containerSize.width;
    const availableHeight = containerSize.height;
    
    // Use the smaller dimension to ensure the D-pad fits and stays square
    const availableSize = Math.min(availableWidth, availableHeight);
    
    // Reserve minimal space for padding and borders
    const padding = Math.max(4, availableSize * 0.05);
    const maxSize = availableSize - (padding * 2);
    
    // Set minimum size for usability but prioritize fitting within grid cell
    const minSize = Math.min(60, maxSize);
    const size = Math.max(minSize, maxSize);
    
    return { size, padding: padding / 2 };
  };

  const { size: dpadSize, padding } = calculateDPadSize();

  // Container style that centers the D-pad and constrains it
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden', // Prevent overflow
    boxSizing: 'border-box'
  };

  // D-pad style with fixed dimensions
  const dpadStyle: React.CSSProperties = {
    width: `${dpadSize}px`,
    height: `${dpadSize}px`,
    display: 'grid',
    gridTemplate: `
      ". up ." 1fr
      "left center right" 1fr  
      ". down ." 1fr
    `,
    gap: `${Math.max(2, padding / 2)}px`,
    opacity: isEditing ? 0.7 : 1,
    flexShrink: 0,
    position: 'relative'
  };

  const buttonStyle = (direction: string): React.CSSProperties => ({
    backgroundColor: pressedDirections.has(direction) 
      ? (config.style?.color || 'var(--primary-color)') 
      : 'var(--secondary-color)',
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid ${pressedDirections.has(direction) 
      ? (config.style?.color || 'var(--primary-color)') 
      : 'var(--border-color)'}`,
    borderRadius: '4px',
    cursor: isEditing ? 'default' : 'pointer',
    userSelect: 'none',
    transition: 'all 0.1s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${Math.max(12, dpadSize * 0.15)}px`,
    fontWeight: 'bold',
    color: pressedDirections.has(direction) ? 'white' : 'var(--text-color)',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden'
  });

  const centerStyle: React.CSSProperties = {
    gridArea: 'center',
    backgroundColor: 'var(--background-color)',
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid var(--border-color)`,
    borderRadius: '50%',
    minWidth: 0,
    minHeight: 0
  };

  return (
    <div className="dpad-component" ref={containerRef} style={containerStyle}>
      <div style={dpadStyle}>
        <button
          className="dpad-up"
          style={{ ...buttonStyle('up'), gridArea: 'up' }}
          onPointerDown={() => handleDirectionPress('up', true)}
          onPointerUp={() => handleDirectionPress('up', false)}
          onPointerLeave={() => handleDirectionPress('up', false)}
          disabled={isEditing}
        >
          ▲
        </button>
        
        <button
          className="dpad-left"
          style={{ ...buttonStyle('left'), gridArea: 'left' }}
          onPointerDown={() => handleDirectionPress('left', true)}
          onPointerUp={() => handleDirectionPress('left', false)}
          onPointerLeave={() => handleDirectionPress('left', false)}
          disabled={isEditing}
        >
          ◀
        </button>
        
        <div className="dpad-center" style={centerStyle} />
        
        <button
          className="dpad-right"
          style={{ ...buttonStyle('right'), gridArea: 'right' }}
          onPointerDown={() => handleDirectionPress('right', true)}
          onPointerUp={() => handleDirectionPress('right', false)}
          onPointerLeave={() => handleDirectionPress('right', false)}
          disabled={isEditing}
        >
          ▶
        </button>
        
        <button
          className="dpad-down"
          style={{ ...buttonStyle('down'), gridArea: 'down' }}
          onPointerDown={() => handleDirectionPress('down', true)}
          onPointerUp={() => handleDirectionPress('down', false)}
          onPointerLeave={() => handleDirectionPress('down', false)}
          disabled={isEditing}
        >
          ▼
        </button>
      </div>
    </div>
  );
};

export default DPadComponent; 