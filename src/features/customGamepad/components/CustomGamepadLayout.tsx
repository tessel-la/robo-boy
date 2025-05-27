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

  // Unified scaling calculation that maintains proportions
  const calculateScaling = () => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) {
      return {
        scaleFactor: 1,
        gridWidth: '100%',
        gridHeight: '100%'
      };
    }

    // Calculate the ideal grid dimensions based on layout
    const basePadding = 16;
    const baseGap = 8;
    const idealGridWidth = layout.gridSize.width * layout.cellSize + (layout.gridSize.width - 1) * baseGap + (basePadding * 2);
    const idealGridHeight = layout.gridSize.height * layout.cellSize + (layout.gridSize.height - 1) * baseGap + (basePadding * 2);

    // Calculate available space with responsive margins
    const marginFactor = Math.min(containerDimensions.width, containerDimensions.height) < 400 ? 0.05 : 0.1;
    const availableWidth = containerDimensions.width * (1 - marginFactor);
    const availableHeight = containerDimensions.height * (1 - marginFactor);
    
    // Calculate scale factor to fit within available space
    const scaleX = availableWidth / idealGridWidth;
    const scaleY = availableHeight / idealGridHeight;
    let scaleFactor = Math.min(scaleX, scaleY, 1); // Never scale up beyond 1
    
    // Ensure minimum usability on very small screens
    const minScale = 0.4;
    scaleFactor = Math.max(minScale, scaleFactor);

    return {
      scaleFactor,
      gridWidth: idealGridWidth * scaleFactor,
      gridHeight: idealGridHeight * scaleFactor
    };
  };

  const scaling = calculateScaling();

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`,
    gridTemplateRows: `repeat(${layout.gridSize.height}, 1fr)`,
    gap: `${Math.max(2, 8 * scaling.scaleFactor)}px`,
    padding: `${Math.max(4, 16 * scaling.scaleFactor)}px`,
    backgroundColor: 'transparent',
    borderRadius: isEditing ? '8px' : '0',
    border: isEditing ? '1px solid var(--border-color-light, #e9ecef)' : 'none',
    position: 'relative',
    width: `${scaling.gridWidth}px`,
    height: `${scaling.gridHeight}px`,
    margin: 'auto',
    boxSizing: 'border-box',
    overflow: 'visible'
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
              padding: `${Math.max(4, 16 * scaling.scaleFactor)}px`
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