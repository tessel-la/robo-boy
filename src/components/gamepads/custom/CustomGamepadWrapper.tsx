import React from 'react';
import type { Ros } from 'roslib';
import { GamepadProps } from '../GamepadInterface';
import CustomGamepadLayout from '../../../features/customGamepad/components/CustomGamepadLayout';
import { getGamepadLayout } from '../../../features/customGamepad/gamepadStorage';

interface CustomGamepadWrapperProps extends GamepadProps {
  layoutId: string;
}

const CustomGamepadWrapper: React.FC<CustomGamepadWrapperProps> = ({ ros, layoutId }) => {
  const gamepadItem = getGamepadLayout(layoutId);
  
  if (!gamepadItem) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        color: 'var(--error-color, #dc3545)',
        textAlign: 'center'
      }}>
        <div>
          <h3>Layout Not Found</h3>
          <p>The gamepad layout "{layoutId}" could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <CustomGamepadLayout
      layout={gamepadItem.layout}
      ros={ros}
      isEditing={false}
    />
  );
};

export default CustomGamepadWrapper; 