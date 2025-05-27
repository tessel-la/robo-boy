import React, { useEffect, useState, useRef } from 'react';
import type { Ros } from 'roslib';
import { CustomGamepadLayout as LayoutType } from '../types';
import GamepadComponent from './GamepadComponent';
import './CustomGamepadLayout.css';

interface CustomGamepadLayoutProps {
  layout: LayoutType;
  ros: Ros;
  isEditing?: boolean;
  selectedComponentId?: string | null;
  onComponentSelect?: (id: string) => void;
  onComponentUpdate?: (id: string, config: any) => void;
  onComponentDelete?: (id: string) => void;
}

const CustomGamepadLayout: React.FC<CustomGamepadLayoutProps> = ({
  layout,
  ros,
  isEditing = false,
  selectedComponentId = null,
  onComponentSelect,
  onComponentUpdate,
  onComponentDelete
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  // Monitor container size changes for responsive scaling
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Improved scaling calculation that prevents cropping and ensures proper centering
  const calculateScaling = () => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) {
      return {
        scaleFactor: 1,
        gridWidth: 300,
        gridHeight: 200,
        containerPadding: 16
      };
    }

    // Calculate the ideal grid dimensions based on layout
    const basePadding = 20;
    const baseGap = 8;
    const idealGridWidth = layout.gridSize.width * layout.cellSize + (layout.gridSize.width - 1) * baseGap + (basePadding * 2);
    const idealGridHeight = layout.gridSize.height * layout.cellSize + (layout.gridSize.height - 1) * baseGap + (basePadding * 2);

    // Calculate available space with improved responsive margins
    // Use minimal margins to keep components large and usable
    const isSmallScreen = Math.min(containerDimensions.width, containerDimensions.height) < 500;
    const isTinyScreen = Math.min(containerDimensions.width, containerDimensions.height) < 350;
    
    let marginFactor: number;
    let extraPadding: number;
    
    if (isTinyScreen) {
      marginFactor = 0.08; // Minimal margin for tiny screens
      extraPadding = 20; // Minimal padding
    } else if (isSmallScreen) {
      marginFactor = 0.05; // Very small margin
      extraPadding = 15;
    } else {
      marginFactor = 0.02; // Almost no margin for normal screens
      extraPadding = 10;
    }
    
    // Ensure we never exceed container dimensions but prioritize larger components
    const availableWidth = Math.max(300, containerDimensions.width * (1 - marginFactor) - extraPadding);
    const availableHeight = Math.max(200, containerDimensions.height * (1 - marginFactor) - extraPadding);
    
    // Calculate scale factor to fit within available space
    const scaleX = availableWidth / idealGridWidth;
    const scaleY = availableHeight / idealGridHeight;
    let scaleFactor = Math.min(scaleX, scaleY, 1.2); // Allow slight scaling up for very large screens
    
    // Much higher minimum scale factors to keep components usable
    let minScale: number;
    if (isTinyScreen) {
      minScale = 0.7; // High minimum scale for very small screens
    } else if (isSmallScreen) {
      minScale = 0.8; // Higher minimum scale
    } else {
      minScale = 0.9; // Very high minimum scale for normal screens
    }
    
    scaleFactor = Math.max(minScale, scaleFactor);

    // Calculate final dimensions ensuring they fit within container
    const finalGridWidth = Math.min(idealGridWidth * scaleFactor, availableWidth);
    const finalGridHeight = Math.min(idealGridHeight * scaleFactor, availableHeight);
    
    // Calculate container padding to ensure proper centering - minimal padding to maximize space
    const containerPadding = Math.max(4, extraPadding / 3);

    return {
      scaleFactor,
      gridWidth: finalGridWidth,
      gridHeight: finalGridHeight,
      containerPadding
    };
  };

  const scaling = calculateScaling();

  // Simplified grid style that ensures proper centering without absolute positioning
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`,
    gridTemplateRows: `repeat(${layout.gridSize.height}, 1fr)`,
    gap: `${Math.max(2, 8 * scaling.scaleFactor)}px`,
    padding: `${Math.max(6, 16 * scaling.scaleFactor)}px`,
    backgroundColor: 'transparent',
    borderRadius: isEditing ? '8px' : '0',
    border: isEditing ? '1px solid var(--border-color-light, #e9ecef)' : 'none',
    position: 'relative',
    width: `${scaling.gridWidth}px`,
    height: `${scaling.gridHeight}px`,
    boxSizing: 'border-box',
    overflow: 'visible', // Critical: Allow components to extend beyond grid for joystick movement
    // Center the grid within its container
    margin: '0 auto',
    flexShrink: 0 // Prevent the grid from shrinking
  };

  // Container style to ensure proper centering and prevent scrollbars
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    padding: `${scaling.containerPadding}px`,
    boxSizing: 'border-box',
    overflow: 'visible', // Allow joystick movement outside container
    // Ensure container fits within parent constraints
    maxWidth: '100%',
    maxHeight: '100%',
    // Prevent the container from creating scrollbars in parent
    minHeight: 0,
    minWidth: 0
  };

  const handleComponentSelect = (id: string) => {
    if (isEditing && onComponentSelect) {
      onComponentSelect(id);
    }
  };

  const handleComponentUpdate = (config: any) => {
    if (isEditing && onComponentUpdate) {
      onComponentUpdate(config.id, config);
    }
  };

  const handleComponentDelete = (id: string) => {
    if (isEditing && onComponentDelete) {
      onComponentDelete(id);
    }
  };

  return (
    <div 
      className={`custom-gamepad-layout ${isEditing ? 'editing' : ''}`}
      ref={containerRef}
      style={containerStyle}
    >
      {/* Grid container */}
      <div className="gamepad-grid" style={gridStyle}>
        {/* Grid background (visible only in editing mode) */}
        {isEditing && (
          <div 
            className="grid-background"
            style={{
              gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`,
              gridTemplateRows: `repeat(${layout.gridSize.height}, 1fr)`,
              gap: `${Math.max(2, 8 * scaling.scaleFactor)}px`,
              padding: `${Math.max(6, 16 * scaling.scaleFactor)}px`
            }}
          >
            {Array.from({ length: layout.gridSize.width * layout.gridSize.height }).map((_, index) => (
              <div
                key={index}
                className="grid-cell"
              />
            ))}
          </div>
        )}

        {/* Gamepad components */}
        {layout.components.map(component => (
          <GamepadComponent
            key={component.id}
            config={component}
            ros={ros}
            isEditing={isEditing}
            isSelected={selectedComponentId === component.id}
            onSelect={handleComponentSelect}
            onUpdate={handleComponentUpdate}
            onDelete={handleComponentDelete}
            scaleFactor={scaling.scaleFactor}
          />
        ))}
      </div>
    </div>
  );
};

export default CustomGamepadLayout; 