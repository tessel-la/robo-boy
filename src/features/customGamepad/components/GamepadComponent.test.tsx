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

const renderSelectedComponent = (
  position: GamepadComponentConfig['position'],
  gridSize = { width: 4, height: 4 }
) => {
  const result = render(
    <GamepadComponent
      config={{ ...baseConfig, position }}
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
});
