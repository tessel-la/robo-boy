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

  // Calculate optimal D-pad size that maintains square proportions while fitting in allocated space
  const calculateOptimalDPadSize = () => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return { width: 100, height: 100, maxSize: 100 };
    }

    // The container represents the exact grid space allocated to the D-pad
    const containerWidth = containerSize.width;
    const containerHeight = containerSize.height;
    
    // Always maintain square proportions by using the smaller dimension
    // This prevents the D-pad from stretching and distorting
    const availableSize = Math.min(containerWidth, containerHeight);
    
    // Reserve small amount of space for padding, but maximize the D-pad size
    const padding = Math.max(4, availableSize * 0.05); // Minimal padding
    const dpadSize = Math.max(30, availableSize - padding); // Minimum 30px for usability
    
    return {
      width: dpadSize,
      height: dpadSize, // Always square
      maxSize: dpadSize
    };
  };

  const optimalSize = calculateOptimalDPadSize();

  // Container style that matches the joystick's simple structure for control button compatibility
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'visible', // Critical: allows control buttons to show outside bounds
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: isEditing ? 0.7 : 1
  };

  // D-pad style with calculated optimal dimensions - always square
  const dpadStyle: React.CSSProperties = {
    width: `${optimalSize.width}px`,
    height: `${optimalSize.height}px`,
    position: 'relative',
    overflow: 'visible', // Ensure this also allows overflow for control buttons
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: '1fr 1fr 1fr',
    gap: '2px', // Fixed gap in pixels for consistency
    padding: '2px' // Fixed padding in pixels for consistency
  };

  const buttonStyle = (direction: string): React.CSSProperties => {
    // Use the calculated optimal size for font scaling
    const effectiveSize = optimalSize.maxSize;
    
    // Calculate font size based on the optimal D-pad size
    let baseFontSize: number;
    
    if (effectiveSize < 60) {
      baseFontSize = Math.max(8, effectiveSize * 0.25);
    } else if (effectiveSize < 80) {
      baseFontSize = Math.max(10, effectiveSize * 0.20);
    } else if (effectiveSize < 120) {
      baseFontSize = Math.max(12, effectiveSize * 0.18);
    } else if (effectiveSize < 160) {
      baseFontSize = Math.max(14, effectiveSize * 0.16);
    } else {
      baseFontSize = Math.max(16, Math.min(36, effectiveSize * 0.14));
    }
    
    const scaledFontSize = Math.max(12, Math.floor(baseFontSize * scaleFactor)); // Ensure minimum 12px font

    // Border radius based on effective size
    const borderRadius = Math.max(3, Math.min(12, Math.floor(effectiveSize * 0.05)));

    // Base button style for grid items - ensure they fill their cells
    const baseStyle: React.CSSProperties = {
      backgroundColor: pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--secondary-color)',
      border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid ${pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--border-color)'}`,
      borderRadius: `${borderRadius}px`,
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
        ? 'inset 0 2px 4px rgba(0,0,0,0.2)' 
        : '0 2px 4px rgba(0,0,0,0.1)',
      transform: pressedDirections.has(direction) ? 'scale(0.95)' : 'scale(1)',
      zIndex: 2,
      // Ensure buttons fill their grid cells completely
      width: '100%',
      height: '100%',
      minWidth: 0,
      minHeight: 0,
      maxWidth: '100%',
      maxHeight: '100%',
      boxSizing: 'border-box',
      padding: 0,
      margin: 0,
      // In editing mode, don't consume pointer events so parent can handle clicks
      pointerEvents: isEditing ? 'none' : 'auto'
    };

    // Grid positioning for each button
    switch (direction) {
      case 'up':
        return {
          ...baseStyle,
          gridColumn: '2 / 3',
          gridRow: '1 / 2'
        };
      case 'down':
        return {
          ...baseStyle,
          gridColumn: '2 / 3',
          gridRow: '3 / 4'
        };
      case 'left':
        return {
          ...baseStyle,
          gridColumn: '1 / 2',
          gridRow: '2 / 3'
        };
      case 'right':
        return {
          ...baseStyle,
          gridColumn: '3 / 4',
          gridRow: '2 / 3'
        };
      default:
        return baseStyle;
    }
  };

  const centerStyle: React.CSSProperties = {
    gridColumn: '2 / 3',
    gridRow: '2 / 3',
    backgroundColor: 'var(--card-bg, #f8f9fa)',
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid var(--border-color)`,
    borderRadius: '50%',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
    zIndex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    maxWidth: '100%',
    maxHeight: '100%',
    boxSizing: 'border-box',
    padding: 0,
    margin: 0
  };

  return (
    <div className="dpad-component" ref={containerRef} style={containerStyle}>
      <div style={dpadStyle}>
        {/* Up button - top center */}
        <button
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
          style={buttonStyle('left')}
          onPointerDown={() => handleDirectionPress('left', true)}
          onPointerUp={() => handleDirectionPress('left', false)}
          onPointerLeave={() => handleDirectionPress('left', false)}
          disabled={isEditing}
        >
          ←
        </button>
        
        {/* Center circle - middle center */}
        <div style={centerStyle} />
        
        {/* Right button - middle right */}
        <button
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