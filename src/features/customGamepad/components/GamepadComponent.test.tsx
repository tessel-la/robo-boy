import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GamepadComponent from './GamepadComponent';
import { GamepadComponentConfig } from '../types';

const baseConfig: GamepadComponentConfig = {
  id: 'button-1',
  type: 'button',
  position: { x: 0, y: 0, width: 1, height: 1 },
  label: 'Button',
};

const dpadConfig: GamepadComponentConfig = {
  id: 'dpad-1',
  type: 'dpad',
  position: { x: 0, y: 1, width: 2, height: 2 },
  label: 'D-Pad',
  action: { topic: '/dpad', messageType: 'sensor_msgs/Joy', field: 'buttons' },
  config: { buttonMapping: { up: 0, right: 1, down: 2, left: 3 } },
};

const renderSelectedComponent = (
  position: GamepadComponentConfig['position'],
  gridSize = { width: 4, height: 4 },
  config: GamepadComponentConfig = baseConfig
) => {
  const result = render(
    <GamepadComponent
      config={{ ...config, position }}
      ros={{ isConnected: true } as any}
      isEditing
      isSelected
      gridSize={gridSize}
      onOpenSettings={vi.fn()}
      onDelete={vi.fn()}
    />
  );

  const component = result.container.querySelector('.gamepad-component');
  expect(component).toBeInTheDocument();
  fireEvent.click(component!);
  expect(screen.getByTitle('Settings')).toBeInTheDocument();

  return result.container.querySelector('.component-controls-popup');
};

describe('GamepadComponent', () => {
  it('places controls below a component that only touches the top grid edge', () => {
    const popup = renderSelectedComponent({ x: 0, y: 0, width: 1, height: 1 });

    expect(popup).toHaveClass('popup-below');
  });

  it('places controls inside a component that spans the full grid height', () => {
    const popup = renderSelectedComponent({ x: 0, y: 0, width: 4, height: 4 });

    expect(popup).toHaveClass('popup-inside');
  });

  it('shows the settings control for selected d-pad components', () => {
    renderSelectedComponent(
      { x: 0, y: 1, width: 2, height: 2 },
      { width: 4, height: 4 },
      dpadConfig
    );

    expect(screen.getByTitle('Settings')).toBeInTheDocument();
  });

  it('opens d-pad controls the same way as other components', () => {
    const EditableDPad = () => {
      const [selectedId, setSelectedId] = React.useState<string | null>(null);

      return (
        <GamepadComponent
          config={dpadConfig}
          ros={{ isConnected: true } as any}
          isEditing
          isSelected={selectedId === dpadConfig.id}
          gridSize={{ width: 4, height: 4 }}
          onSelect={setSelectedId}
          onOpenSettings={vi.fn()}
          onDelete={vi.fn()}
        />
      );
    };

    const { container } = render(<EditableDPad />);

    const component = container.querySelector('.gamepad-component.component-dpad');
    expect(component).toBeInTheDocument();

    fireEvent.click(component!);
    expect(screen.queryByTitle('Settings')).not.toBeInTheDocument();

    fireEvent.click(component!);

    expect(screen.getByTitle('Settings')).toBeInTheDocument();
    expect(screen.getByTitle('Delete')).toBeInTheDocument();
    expect(container.querySelectorAll('.component-controls-popup .control-button')).toHaveLength(2);
  });
});
