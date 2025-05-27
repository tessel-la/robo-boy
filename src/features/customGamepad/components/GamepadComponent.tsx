import React from 'react';
import type { Ros } from 'roslib';
import { GamepadComponentConfig } from '../types';
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
  scaleFactor?: number;
  onSelect?: (id: string) => void;
  onUpdate?: (config: GamepadComponentConfig) => void;
  onDelete?: (id: string) => void;
}

const GamepadComponent: React.FC<GamepadComponentProps> = ({
  config,
  ros,
  isEditing = false,
  isSelected = false,
  scaleFactor = 1,
  onSelect,
  onUpdate,
  onDelete
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

  return (
    <div
      className={`gamepad-component ${config.type} ${isSelected ? 'selected' : ''} ${isEditing ? 'editing' : ''}`}
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
      
      {/* Editing controls */}
      {isEditing && (
        <div className="editing-controls">
          {isSelected && (
            <button
              className="delete-button"
              onClick={handleDelete}
              title="Delete component"
            >
              ×
            </button>
          )}
          <div className="resize-handles">
            <div className="resize-handle bottom-right" />
          </div>
        </div>
      )}
    </div>
  );
};

export default GamepadComponent; 