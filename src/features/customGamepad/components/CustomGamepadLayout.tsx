import React, { useEffect, useState, useRef } from 'react';
import type { Ros } from 'roslib';
import { CustomGamepadLayout as LayoutType, ComponentInteractionMode } from '../types';
import GamepadComponent from './GamepadComponent';
import './CustomGamepadLayout.css';

interface CustomGamepadLayoutProps {
  layout: LayoutType;
  ros: Ros;
  isEditing?: boolean;
  selectedComponentId?: string | null;
  interactionMode?: ComponentInteractionMode;
  onComponentSelect?: (id: string) => void;
  onComponentUpdate?: (id: string, config: any) => void;
  onComponentDelete?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
}

const CustomGamepadLayout: React.FC<CustomGamepadLayoutProps> = ({
  layout,
  ros,
  isEditing = false,
  selectedComponentId = null,
  interactionMode,
  onComponentSelect,
  onComponentUpdate,
  onComponentDelete,
  onOpenSettings
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
        containerPadding: 4
      };
    }

    // Calculate the ideal grid dimensions based on fixed cell sizes
    const basePadding = 12; // Further reduced from 16
    const baseGap = 4; // Further reduced from 6
    const idealGridWidth = layout.gridSize.width * layout.cellSize + (layout.gridSize.width - 1) * baseGap + (basePadding * 2);
    const idealGridHeight = layout.gridSize.height * layout.cellSize + (layout.gridSize.height - 1) * baseGap + (basePadding * 2);

    // Calculate available space with maximum space utilization
    // Use minimal margins to maximize grid size, especially horizontally
    const isSmallScreen = Math.min(containerDimensions.width, containerDimensions.height) < 500;
    const isTinyScreen = Math.min(containerDimensions.width, containerDimensions.height) < 350;
    
    let marginFactor: number;
    let extraPadding: number;
    
    if (isTinyScreen) {
      marginFactor = 0.02; // Minimal margin for tiny screens
      extraPadding = 6; // Minimal padding
    } else if (isSmallScreen) {
      marginFactor = 0.015; // Minimal margin for small screens
      extraPadding = 4; // Minimal padding
    } else {
      marginFactor = 0.005; // Almost no margin for normal screens
      extraPadding = 2; // Almost no padding
    }
    
    // Maximize available space - use nearly the entire container
    const availableWidth = Math.max(180, containerDimensions.width * (1 - marginFactor) - extraPadding);
    const availableHeight = Math.max(120, containerDimensions.height * (1 - marginFactor) - extraPadding);
    
    // Calculate scale factor to fit within available space
    const scaleX = availableWidth / idealGridWidth;
    const scaleY = availableHeight / idealGridHeight;
    let scaleFactor = Math.min(scaleX, scaleY);
    
    // Remove artificial maximum scale limits to allow components to truly fill grid space
    // Allow scale factors greater than 1 to maximize space utilization
    
    // Set very minimal minimum scale factors to allow maximum expansion
    let minScale: number;
    if (isTinyScreen) {
      minScale = 0.15; // Even smaller minimum for tiny screens
    } else if (isSmallScreen) {
      minScale = 0.2; // Smaller minimum for small screens
    } else {
      minScale = 0.25; // Reasonable minimum for normal screens
    }
    
    scaleFactor = Math.max(minScale, scaleFactor);

    // Calculate final dimensions ensuring they fit within container
    const finalGridWidth = idealGridWidth * scaleFactor;
    const finalGridHeight = idealGridHeight * scaleFactor;
    
    // Minimal container padding to maximize grid space
    const containerPadding = Math.max(1, extraPadding / 6);

    return {
      scaleFactor,
      gridWidth: finalGridWidth,
      gridHeight: finalGridHeight,
      containerPadding
    };
  };

  const scaling = calculateScaling();

  // Calculate fixed cell dimensions that fit within the scaled grid
  const cellWidth = isEditing 
    ? Math.floor(layout.cellSize * scaling.scaleFactor)
    : `minmax(${Math.floor(layout.cellSize * 0.5)}px, 1fr)`;
  const cellHeight = isEditing 
    ? Math.floor(layout.cellSize * scaling.scaleFactor)
    : `minmax(${Math.floor(layout.cellSize * 0.5)}px, 1fr)`;
  const gap = Math.max(1, Math.floor(4 * scaling.scaleFactor));
  const padding = isEditing ? Math.max(2, Math.floor(8 * scaling.scaleFactor)) : 8;

  // Use the pre-calculated grid dimensions from scaling to ensure proper fit
  const actualGridWidth = scaling.gridWidth;
  const actualGridHeight = scaling.gridHeight;

  // Grid style with adaptive cell dimensions that maintain proper aspect ratios
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: isEditing 
      ? `repeat(${layout.gridSize.width}, 1fr)` // Use fractional units for flexible horizontal scaling
      : `repeat(${layout.gridSize.width}, ${cellWidth})`,
    gridTemplateRows: isEditing 
      ? `repeat(${layout.gridSize.height}, ${Math.floor(layout.cellSize * scaling.scaleFactor)}px)` // Use calculated size to maintain proportions
      : `repeat(${layout.gridSize.height}, ${cellHeight})`,
    gap: `${gap}px`,
    padding: `${padding}px`,
    backgroundColor: 'transparent',
    borderRadius: isEditing ? '8px' : '0',
    border: 'none', // Remove border completely for both editing and non-editing modes
    position: 'relative',
    // Use 100% width and auto height to prevent collapse
    width: '100%',
    height: isEditing ? 'auto' : '100%',
    minHeight: isEditing ? `${Math.max(300, scaling.gridHeight)}px` : 'auto', // Prevent collapse with minimum height
    boxSizing: 'border-box',
    overflow: 'visible', // Allow joystick movement outside grid bounds
    margin: '0 auto', // Center the grid horizontally
    flexShrink: 0, // Prevent the grid from shrinking
    justifyContent: 'center', // Center grid content horizontally
    alignContent: 'center', // Center grid content vertically
    // Ensure grid scales to use available space
    minWidth: 0,
    maxWidth: '100%',
    maxHeight: '100%'
  };

  // Container style to ensure proper scaling and space utilization
  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center', // Keep centering for proper layout
    justifyContent: 'center', // Keep centering for proper layout
    position: 'relative',
    padding: `${scaling.containerPadding}px`,
    boxSizing: 'border-box',
    overflow: 'hidden', // Prevent scrollbars by hiding overflow
    // Ensure container fits within parent constraints
    maxWidth: '100%',
    maxHeight: '100%',
    // Prevent the container from creating scrollbars in parent
    minHeight: 0,
    minWidth: 0,
    // Support flex growth for proper scaling
    flex: '1 1 auto'
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
        {/* Grid background (visible only in editing mode) - positioned to exactly match main grid */}
        {isEditing && (
          <div 
            className="grid-background"
            style={{
              // Make the background grid exactly mirror the main grid layout
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%) translateZ(0)', // Center both horizontally and vertically, plus force GPU acceleration
              width: '100%',
              display: 'grid',
              gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`,
              gridTemplateRows: `repeat(${layout.gridSize.height}, ${Math.floor(layout.cellSize * scaling.scaleFactor)}px)`,
              gap: `${gap}px`,
              padding: `${padding}px`,
              // Mirror all size-affecting properties from main grid - EXACT match
              backgroundColor: 'transparent',
              borderRadius: isEditing ? '8px' : '0',
              border: 'none', // Remove border completely to match main grid
              boxSizing: 'border-box',
              margin: '0',
              transition: 'all 0.2s ease', // Match the transition from .gamepad-grid CSS
              // Ensure it's exactly overlaid
              zIndex: '0',
              pointerEvents: 'none'
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
            interactionMode={selectedComponentId === component.id ? interactionMode : ComponentInteractionMode.None}
            gridSize={layout.gridSize}
            onSelect={handleComponentSelect}
            onUpdate={handleComponentUpdate}
            onDelete={handleComponentDelete}
            onOpenSettings={onOpenSettings}
            scaleFactor={scaling.scaleFactor}
          />
        ))}
      </div>
    </div>
  );
};

export default CustomGamepadLayout; 