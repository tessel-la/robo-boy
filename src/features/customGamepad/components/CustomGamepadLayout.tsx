import React from 'react';
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
  // Calculate optimal cell size to fit the container better
  const calculateOptimalCellSize = () => {
    if (isEditing) {
      return layout.cellSize; // Use original size in editing mode
    }
    
    // For display mode, use percentage-based sizing to fill available space
    // This makes the gamepad responsive and fill the container like default gamepads
    return 'auto'; // Let CSS handle the sizing
  };

  const cellSize = calculateOptimalCellSize();

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`, // Always use fractional units for consistent sizing
    gridTemplateRows: `repeat(${layout.gridSize.height}, 1fr)`, // Always use fractional units for consistent sizing
    gap: '8px', // Consistent gap for both modes
    padding: '16px', // Consistent padding for both modes
    backgroundColor: 'transparent', // Always transparent to match theme
    borderRadius: '0', // No border radius for cleaner look
    border: 'none', // No border for cleaner look
    position: 'relative',
    width: '100%', // Always full width for better representation
    height: isEditing ? '300px' : '100%', // Fixed height in editing mode to prevent excessive vertical space
    margin: '0',
    maxWidth: '100%',
    maxHeight: '100%',
    minHeight: isEditing ? '300px' : 'auto' // Ensure consistent minimum height
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
    <div className={`custom-gamepad-layout ${isEditing ? 'editing' : ''}`}>
      {/* Gamepad preview header (only in editing mode) */}
      {isEditing && (
        <div className="gamepad-preview-header">
          <h4 className="gamepad-preview-title">{layout.name}</h4>
          <p className="gamepad-preview-subtitle">Custom Gamepad Preview</p>
        </div>
      )}
      
      {/* Grid container */}
      <div className="gamepad-grid" style={gridStyle}>
        {/* Grid background (visible only in editing mode) */}
        {isEditing && (
          <div 
            className="grid-background"
            style={{
              gridTemplateColumns: `repeat(${layout.gridSize.width}, 1fr)`,
              gridTemplateRows: `repeat(${layout.gridSize.height}, 1fr)`
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
          />
        ))}
      </div>


    </div>
  );
};

export default CustomGamepadLayout; 