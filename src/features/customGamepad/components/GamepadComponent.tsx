import React from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig, ComponentInteractionMode } from '../types';
import JoystickComponent from './JoystickComponent';
import ButtonComponent from './ButtonComponent';
import DPadComponent from './DPadComponent';
import ToggleComponent from './ToggleComponent';
import SliderComponent from './SliderComponent';
import './GamepadComponent.css';

interface GamepadComponentProps {
  config: GamepadComponentConfig;
  ros: Ros;
  isEditing?: boolean;
  isSelected?: boolean;
  isBeingDragged?: boolean;
  interactionMode?: ComponentInteractionMode;
  scaleFactor?: number;
  gridSize?: { width: number; height: number };
  onSelect?: (id: string) => void;
  onUpdate?: (config: GamepadComponentConfig) => void;
  onDelete?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}

const GamepadComponent: React.FC<GamepadComponentProps> = ({
  config,
  ros,
  isEditing = false,
  isSelected = false,
  isBeingDragged = false,
  interactionMode = ComponentInteractionMode.None,
  scaleFactor = 1,
  gridSize = { width: 8, height: 4 },
  onSelect,
  onUpdate,
  onDelete,
  onOpenSettings,
  onDragStart,
  onDragEnd
}) => {
  const handleClick = (e: React.MouseEvent) => {
    if (isEditing && onSelect) {
      e.stopPropagation();
      onSelect(config.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(config.id);
    }
  };

  const handleOpenSettings = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenSettings) {
      onOpenSettings(config.id);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!isEditing) return;
    
    e.stopPropagation();
    e.dataTransfer.setData('text/plain', config.id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Create simple drag image
    const dragImage = document.createElement('div');
    dragImage.innerHTML = `<span>${config.label || config.type}</span>`;
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      padding: 8px 12px;
      background: var(--primary-color, #007bff);
      color: white;
      border-radius: 6px;
      font-weight: 500;
      font-size: 13px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      pointer-events: none;
      z-index: 10000;
    `;
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 40, 20);
    
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
    
    if (onDragStart) {
      onDragStart(config.id);
    }
  };

  const handleDragEnd = () => {
    if (onDragEnd) {
      onDragEnd();
    }
  };

  // Touch event handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isEditing || interactionMode !== ComponentInteractionMode.Translate) return;
    
    e.stopPropagation();
    if (onDragStart) {
      onDragStart(config.id);
    }
  };

  const handleTranslate = (deltaX: number, deltaY: number) => {
    if (!onUpdate) return;
    
    const newX = Math.max(0, Math.min(config.position.x + deltaX, gridSize.width - config.position.width));
    const newY = Math.max(0, Math.min(config.position.y + deltaY, gridSize.height - config.position.height));
    
    onUpdate({
      ...config,
      position: {
        ...config.position,
        x: newX,
        y: newY
      }
    });
  };

  const handleResize = (deltaWidth: number, deltaHeight: number) => {
    if (!onUpdate) return;
    
    const newWidth = Math.max(1, Math.min(config.position.width + deltaWidth, gridSize.width - config.position.x));
    const newHeight = Math.max(1, Math.min(config.position.height + deltaHeight, gridSize.height - config.position.y));
    
    onUpdate({
      ...config,
      position: {
        ...config.position,
        width: newWidth,
        height: newHeight
      }
    });
  };

  const renderComponent = () => {
    const commonProps = {
      config,
      ros,
      isEditing,
      scaleFactor
    };

    switch (config.type) {
      case 'joystick':
        return <JoystickComponent {...commonProps} />;
      case 'button':
        return <ButtonComponent {...commonProps} />;
      case 'dpad':
        return <DPadComponent {...commonProps} />;
      case 'toggle':
        return <ToggleComponent {...commonProps} />;
      case 'slider':
        return <SliderComponent {...commonProps} />;
      default:
        return <div className="unknown-component">Unknown component type</div>;
    }
  };

  const style: React.CSSProperties = {
    gridColumn: `${config.position.x + 1} / span ${config.position.width}`,
    gridRow: `${config.position.y + 1} / span ${config.position.height}`,
    position: 'relative'
  };

  const getComponentClass = () => {
    let className = `gamepad-component ${config.type}`;
    if (isEditing) className += ' editing';
    if (isBeingDragged) className += ' being-dragged';
    if (isSelected) {
      className += ' selected';
      if (interactionMode === ComponentInteractionMode.Translate) {
        className += ' translate-mode';
      } else if (interactionMode === ComponentInteractionMode.Resize) {
        className += ' resize-mode';
      }
    }
    return className;
  };

  return (
    <div
      className={getComponentClass()}
      style={style}
      onClick={handleClick}
      draggable={isEditing && interactionMode === ComponentInteractionMode.Translate}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      data-component-id={config.id}
    >
      {renderComponent()}
      
      {/* Label */}
      {config.label && (
        <div className="component-label" style={{ fontSize: `${0.7 * scaleFactor}em` }}>
          {config.label}
        </div>
      )}
      
      {/* Interaction controls */}
      {isEditing && isSelected && (
        <div className="interaction-controls">
          {/* Delete button (always visible when selected) */}
          <button
            className="control-button delete-button"
            onClick={handleDelete}
            title="Delete component"
          >
            ×
          </button>

          {/* Settings button (always visible when selected) */}
          <button
            className="control-button settings-button"
            onClick={handleOpenSettings}
            title="Component settings"
          >
            ⚙️
          </button>

          {/* Translation controls */}
          {interactionMode === ComponentInteractionMode.Translate && (
            <div className="translate-controls">
              <button
                className="control-button translate-button up"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTranslate(0, -1);
                }}
                disabled={config.position.y <= 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                className="control-button translate-button down"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTranslate(0, 1);
                }}
                disabled={config.position.y >= gridSize.height - config.position.height}
                title="Move down"
              >
                ↓
              </button>
              <button
                className="control-button translate-button left"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTranslate(-1, 0);
                }}
                disabled={config.position.x <= 0}
                title="Move left"
              >
                ←
              </button>
              <button
                className="control-button translate-button right"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTranslate(1, 0);
                }}
                disabled={config.position.x >= gridSize.width - config.position.width}
                title="Move right"
              >
                →
              </button>
            </div>
          )}

          {/* Resize controls */}
          {interactionMode === ComponentInteractionMode.Resize && (
            <div className="resize-controls">
              <button
                className="control-button resize-button width-plus"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResize(1, 0);
                }}
                disabled={config.position.width >= gridSize.width - config.position.x}
                title="Increase width"
              >
                +
              </button>
              <button
                className="control-button resize-button width-minus"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResize(-1, 0);
                }}
                disabled={config.position.width <= 1}
                title="Decrease width"
              >
                −
              </button>
              <button
                className="control-button resize-button height-plus"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResize(0, 1);
                }}
                disabled={config.position.height >= gridSize.height - config.position.y}
                title="Increase height"
              >
                +
              </button>
              <button
                className="control-button resize-button height-minus"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResize(0, -1);
                }}
                disabled={config.position.height <= 1}
                title="Decrease height"
              >
                −
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GamepadComponent; 