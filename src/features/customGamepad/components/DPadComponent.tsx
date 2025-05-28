import React, { useEffect, useRef, useCallback, useState } from 'react';
import type { Topic, Ros } from 'roslib';
import ROSLIB from 'roslib';
import { throttle } from 'lodash-es';
import { GamepadComponentConfig, ROSTopicConfig } from '../types';
import './DPadComponent.css';

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
    // Always use 100% of the available container space
    // The grid system already handles the proper sizing
    return { 
      size: '100%', 
      padding: '0%' 
    };
  };

  const { size: dpadSize } = calculateDPadSize();

  // Container style that centers the D-pad and constrains it
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible', // Changed from 'hidden' to allow proper scaling
    boxSizing: 'border-box',
    // Remove any size constraints
    minWidth: 0,
    minHeight: 0
  };

  // D-pad style with responsive dimensions that scale with container
  const dpadStyle: React.CSSProperties = {
    width: '100%',  // Fill the entire container
    height: '100%', // Fill the entire container
    position: 'relative',
    opacity: isEditing ? 0.7 : 1,
    flexShrink: 1, // Allow shrinking
    flexGrow: 1,   // Allow growing to fill space
    aspectRatio: '1', // Maintain square aspect ratio
    maxWidth: '100%',
    maxHeight: '100%',
    minWidth: 0,
    minHeight: 0,
    boxSizing: 'border-box'
  };

  const buttonStyle = (direction: string): React.CSSProperties => {
    // Get actual container size for calculations
    const actualSize = Math.min(containerSize.width, containerSize.height);
    
    // Calculate font size based on actual container size
    let baseFontSize: number;
    if (actualSize < 60) {
      baseFontSize = Math.max(8, actualSize * 0.2); // Scale with container size
    } else if (actualSize < 80) {
      baseFontSize = Math.max(10, actualSize * 0.15); // Scale with container size
    } else {
      baseFontSize = Math.max(12, Math.min(24, actualSize * 0.12)); // Standard scaling
    }
    
    const scaledFontSize = Math.floor(baseFontSize * scaleFactor);

    // Base button style for grid items - ensure they fill their cells
    const baseStyle: React.CSSProperties = {
      backgroundColor: pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--secondary-color)',
      border: `${Math.max(1, Math.floor(1.5 * scaleFactor))}px solid ${pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--border-color)'}`,
      borderRadius: `${Math.max(2, Math.floor(actualSize * 0.03))}px`,
      cursor: isEditing ? 'default' : 'pointer',
      userSelect: 'none',
      transition: 'all 0.1s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: `${scaledFontSize}px`,
      fontWeight: 'bold',
      color: pressedDirections.has(direction) ? 'white' : 'var(--text-color)',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: 1,
      textAlign: 'center' as const,
      boxShadow: pressedDirections.has(direction) 
        ? 'inset 0 1px 2px rgba(0,0,0,0.2)' 
        : '0 1px 2px rgba(0,0,0,0.1)',
      transform: pressedDirections.has(direction) ? 'scale(0.95)' : 'scale(1)',
      zIndex: 2,
      // Ensure buttons fill their grid cells completely
      width: '100% !important',
      height: '100% !important',
      minWidth: '0 !important',
      minHeight: '0 !important',
      maxWidth: '100%',
      maxHeight: '100%',
      boxSizing: 'border-box',
      // Remove any padding that might cause overflow
      padding: '0',
      margin: '0'
    };

    // Grid positioning for each button
    switch (direction) {
      case 'up':
        return {
          ...baseStyle,
          gridColumn: '2 / 3', // More explicit grid positioning
          gridRow: '1 / 2'     // More explicit grid positioning
        };
      case 'down':
        return {
          ...baseStyle,
          gridColumn: '2 / 3', // More explicit grid positioning
          gridRow: '3 / 4'     // More explicit grid positioning
        };
      case 'left':
        return {
          ...baseStyle,
          gridColumn: '1 / 2', // More explicit grid positioning
          gridRow: '2 / 3'     // More explicit grid positioning
        };
      case 'right':
        return {
          ...baseStyle,
          gridColumn: '3 / 4', // More explicit grid positioning
          gridRow: '2 / 3'     // More explicit grid positioning
        };
      default:
        return baseStyle;
    }
  };

  const centerStyle: React.CSSProperties = {
    gridColumn: '2 / 3', // More explicit grid positioning
    gridRow: '2 / 3',    // More explicit grid positioning
    backgroundColor: 'var(--card-bg, #f8f9fa)',
    border: `${Math.max(1, Math.floor(1.5 * scaleFactor))}px solid var(--border-color)`,
    borderRadius: '50%',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)',
    zIndex: 1,
    width: '100% !important',
    height: '100% !important',
    minWidth: '0 !important',
    minHeight: '0 !important',
    maxWidth: '100%',
    maxHeight: '100%',
    boxSizing: 'border-box',
    padding: '0',
    margin: '0'
  };

  return (
    <div className="dpad-component" ref={containerRef} style={containerStyle}>
      <div className="custom-dpad-grid" style={dpadStyle}>
        {/* Up button - top center */}
        <button
          className="custom-dpad-button custom-dpad-up"
          style={buttonStyle('up')}
          onPointerDown={() => handleDirectionPress('up', true)}
          onPointerUp={() => handleDirectionPress('up', false)}
          onPointerLeave={() => handleDirectionPress('up', false)}
          disabled={isEditing}
        >
          ↑
        </button>
        
        {/* Left button - middle left */}
        <button
          className="custom-dpad-button custom-dpad-left"
          style={buttonStyle('left')}
          onPointerDown={() => handleDirectionPress('left', true)}
          onPointerUp={() => handleDirectionPress('left', false)}
          onPointerLeave={() => handleDirectionPress('left', false)}
          disabled={isEditing}
        >
          ←
        </button>
        
        {/* Center circle - middle center */}
        <div 
          className="custom-dpad-center" 
          style={centerStyle}
        />
        
        {/* Right button - middle right */}
        <button
          className="custom-dpad-button custom-dpad-right"
          style={buttonStyle('right')}
          onPointerDown={() => handleDirectionPress('right', true)}
          onPointerUp={() => handleDirectionPress('right', false)}
          onPointerLeave={() => handleDirectionPress('right', false)}
          disabled={isEditing}
        >
          →
        </button>
        
        {/* Down button - bottom center */}
        <button
          className="custom-dpad-button custom-dpad-down"
          style={buttonStyle('down')}
          onPointerDown={() => handleDirectionPress('down', true)}
          onPointerUp={() => handleDirectionPress('down', false)}
          onPointerLeave={() => handleDirectionPress('down', false)}
          disabled={isEditing}
        >
          ↓
        </button>
      </div>
    </div>
  );
};

export default DPadComponent; 