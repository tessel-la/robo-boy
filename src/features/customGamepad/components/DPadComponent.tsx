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

  // D-pad style with fixed dimensions and relative positioning
  const dpadStyle: React.CSSProperties = {
    width: `${dpadSize}px`,
    height: `${dpadSize}px`,
    position: 'relative',
    opacity: isEditing ? 0.7 : 1,
    flexShrink: 0
  };

  const buttonStyle = (direction: string): React.CSSProperties => {
    // Calculate button size with better scaling - use a larger proportion for smaller screens
    const minButtonSize = 24; // Minimum button size for touch targets
    const buttonRatio = dpadSize < 80 ? 0.4 : 0.33; // Larger buttons on smaller D-pads
    const buttonSize = Math.max(minButtonSize, Math.floor(dpadSize * buttonRatio));
    const centerPos = Math.floor((dpadSize - buttonSize) / 2);
    
    // Calculate gap between buttons for better spacing
    const gap = Math.max(2, Math.floor(dpadSize * 0.02));
    
    let positionStyle: React.CSSProperties = {};
    
    switch (direction) {
      case 'up':
        positionStyle = {
          top: gap,
          left: centerPos,
          width: buttonSize,
          height: buttonSize
        };
        break;
      case 'down':
        positionStyle = {
          bottom: gap,
          left: centerPos,
          width: buttonSize,
          height: buttonSize
        };
        break;
      case 'left':
        positionStyle = {
          top: centerPos,
          left: gap,
          width: buttonSize,
          height: buttonSize
        };
        break;
      case 'right':
        positionStyle = {
          top: centerPos,
          right: gap,
          width: buttonSize,
          height: buttonSize
        };
        break;
    }

    // Scale font size based on button size and screen size
    const baseFontSize = Math.max(10, Math.min(20, buttonSize * 0.5));
    const scaledFontSize = Math.floor(baseFontSize * scaleFactor);

    return {
      position: 'absolute' as const,
      ...positionStyle,
      backgroundColor: pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--secondary-color)',
      border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid ${pressedDirections.has(direction) 
        ? (config.style?.color || 'var(--primary-color)') 
        : 'var(--border-color)'}`,
      borderRadius: `${Math.max(3, Math.floor(buttonSize * 0.15))}px`,
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
      // Ensure minimum touch target size on mobile
      minWidth: `${minButtonSize}px`,
      minHeight: `${minButtonSize}px`
    };
  };

  const centerStyle: React.CSSProperties = {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: `${Math.max(16, Math.floor(dpadSize * 0.25))}px`,
    height: `${Math.max(16, Math.floor(dpadSize * 0.25))}px`,
    backgroundColor: 'var(--card-bg, #f8f9fa)',
    border: `${Math.max(1, Math.floor(2 * scaleFactor))}px solid var(--border-color)`,
    borderRadius: '50%',
    boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.1)',
    zIndex: 1
  };

  return (
    <div className="dpad-component" ref={containerRef} style={containerStyle}>
      <div style={dpadStyle}>
        {/* Up button - top center */}
        <button
          className="dpad-up"
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
          className="dpad-left"
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
          className="dpad-center" 
          style={centerStyle}
        />
        
        {/* Right button - middle right */}
        <button
          className="dpad-right"
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
          className="dpad-down"
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