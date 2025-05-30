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
  interactionMode?: ComponentInteractionMode;
  scaleFactor?: number;
  onSelect?: (id: string) => void;
  onUpdate?: (config: GamepadComponentConfig) => void;
  onDelete?: (id: string) => void;
  onOpenSettings?: (id: string) => void;
}

const GamepadComponent: React.FC<GamepadComponentProps> = ({
  config,
  ros,
  isEditing = false,
  isSelected = false,
  interactionMode = ComponentInteractionMode.None,
  scaleFactor = 1,
  onSelect,
  onUpdate,
  onDelete,
  onOpenSettings
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

  const handleTranslate = (deltaX: number, deltaY: number) => {
    if (!onUpdate) return;
    
    const newX = Math.max(0, Math.min(config.position.x + deltaX, 7 - config.position.width));
    const newY = Math.max(0, Math.min(config.position.y + deltaY, 3 - config.position.height));
    
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
    
    const newWidth = Math.max(1, Math.min(config.position.width + deltaWidth, 8 - config.position.x));
    const newHeight = Math.max(1, Math.min(config.position.height + deltaHeight, 4 - config.position.y));
    
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
    if (isSelected) {
      className += ' selected';
      if (interactionMode === ComponentInteractionMode.Translate) {
        className += ' translate-mode';
      } else if (interactionMode === ComponentInteractionMode.Resize) {
        className += ' resize-mode';
      } else if (interactionMode === ComponentInteractionMode.Settings) {
        className += ' settings-mode';
      }
    }
    return className;
  };

  return (
    <div
      className={getComponentClass()}
      style={style}
      onClick={handleClick}
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
                disabled={config.position.y >= 3 - config.position.height}
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
                disabled={config.position.x >= 7 - config.position.width}
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
                disabled={config.position.width >= 8 - config.position.x}
                title="Increase width"
              >
                ⟷+
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
                ⟷-
              </button>
              <button
                className="control-button resize-button height-plus"
                onClick={(e) => {
                  e.stopPropagation();
                  handleResize(0, 1);
                }}
                disabled={config.position.height >= 4 - config.position.y}
                title="Increase height"
              >
                ↕+
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
                ↕-
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GamepadComponent; 