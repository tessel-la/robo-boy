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
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.gridSize.width}, ${layout.cellSize}px)`,
    gridTemplateRows: `repeat(${layout.gridSize.height}, ${layout.cellSize}px)`,
    gap: '2px',
    padding: '10px',
    backgroundColor: 'var(--background-color, #f8f9fa)',
    borderRadius: '8px',
    border: isEditing ? '2px dashed var(--border-color, #ddd)' : 'none',
    position: 'relative',
    width: 'fit-content',
    height: 'fit-content',
    margin: '0 auto'
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
      {/* Layout info */}
      <div className="layout-header">
        <h3 className="layout-title">{layout.name}</h3>
        {layout.description && (
          <p className="layout-description">{layout.description}</p>
        )}
      </div>

      {/* Grid container */}
      <div className="gamepad-grid" style={gridStyle}>
        {/* Grid background (visible only in editing mode) */}
        {isEditing && (
          <div className="grid-background">
            {Array.from({ length: layout.gridSize.width * layout.gridSize.height }).map((_, index) => (
              <div
                key={index}
                className="grid-cell"
                style={{
                  gridColumn: (index % layout.gridSize.width) + 1,
                  gridRow: Math.floor(index / layout.gridSize.width) + 1,
                  border: '1px solid var(--border-color-light, #e9ecef)',
                  backgroundColor: 'transparent',
                  opacity: 0.5
                }}
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

      {/* Layout metadata (visible only in editing mode) */}
      {isEditing && (
        <div className="layout-metadata">
          <div className="metadata-item">
            <span className="metadata-label">Grid Size:</span>
            <span className="metadata-value">{layout.gridSize.width} × {layout.gridSize.height}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Cell Size:</span>
            <span className="metadata-value">{layout.cellSize}px</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Components:</span>
            <span className="metadata-value">{layout.components.length}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Default Topic:</span>
            <span className="metadata-value">{layout.rosConfig.defaultTopic}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomGamepadLayout; 