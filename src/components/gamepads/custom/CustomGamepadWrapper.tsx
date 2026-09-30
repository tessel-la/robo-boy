import React from 'react';
import { GamepadProps } from '../GamepadInterface';
import CustomGamepadLayout from '../../../features/customGamepad/components/CustomGamepadLayout';
import { getGamepadLayout } from '../../../features/customGamepad/gamepadStorage';
import { usePadPresentation } from '../../../features/customGamepad/presentation';

interface CustomGamepadWrapperProps extends GamepadProps {
  layoutId: string;
  panelId?: string;
  storageScope?: string;
  layouts?: readonly { id: string; name: string }[];
  onSelectLayout?: (id: string) => void;
}

const CustomGamepadWrapper: React.FC<CustomGamepadWrapperProps> = ({ ros, layoutId, panelId, storageScope, layouts = [], onSelectLayout }) => {
  const gamepadItem = getGamepadLayout(layoutId);
  usePadPresentation(panelId, storageScope, { layoutId, layouts, selectLayout: id => onSelectLayout?.(id) });

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
