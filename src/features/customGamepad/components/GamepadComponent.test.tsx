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

  it('shows its tools as soon as it is selected, and keeps them on a second click', () => {
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
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

    fireEvent.click(component!);
    const toolbar = screen.getByRole('toolbar', { name: 'D-Pad tools' });
    expect(toolbar).toHaveTextContent('2×2');
    expect(screen.getByRole('button', { name: 'Settings' }).querySelector('svg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' }).querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('.component-resize-handle')).toHaveLength(8);

    fireEvent.click(component!);
    expect(screen.getByRole('toolbar', { name: 'D-Pad tools' })).toBeInTheDocument();
  });
});

// jsdom has no PointerEvent; the resize handles only need its pointer id and coordinates.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

describe('GamepadComponent resizing', () => {
  const renderResizable = (occupied = [{ x: 3, y: 0, width: 1, height: 4 }]) => {
    (window as any).PointerEvent = TestPointerEvent;
    const onUpdate = vi.fn();
    const result = render(
      <GamepadComponent
        config={{ ...baseConfig, position: { x: 0, y: 0, width: 1, height: 1 } }}
        ros={{ isConnected: true } as any}
        isEditing
        isSelected
        gridSize={{ width: 6, height: 4 }}
        occupied={occupied}
        onUpdate={onUpdate}
      />
    );
    // No rendered grid here: a cell is the component's own 50px box.
    vi.spyOn(result.container.querySelector('.gamepad-component')!, 'getBoundingClientRect')
      .mockReturnValue({ left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50, x: 0, y: 0, toJSON: () => ({}) });
    return { ...result, onUpdate };
  };

  it('grows by whole cells as the pointer moves, stopping at a neighbour', () => {
    const { container, onUpdate } = renderResizable();
    const corner = container.querySelector('.component-resize-handle.se')!;

    fireEvent.pointerDown(corner, { pointerId: 7, clientX: 50, clientY: 50 });
    expect(container.querySelector('.gamepad-component')).toHaveClass('resizing');
    expect(screen.getByText('1 × 1')).toBeInTheDocument();

    fireEvent.pointerMove(corner, { pointerId: 7, clientX: 104, clientY: 80 });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ position: { x: 0, y: 0, width: 2, height: 2 } }));

    // Column 3 is taken: dragging well past it stops at three columns.
    fireEvent.pointerMove(corner, { pointerId: 7, clientX: 400, clientY: 80 });
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ position: { x: 0, y: 0, width: 3, height: 2 } }));

    // Another pointer does not steer it; letting go ends it.
    onUpdate.mockClear();
    fireEvent.pointerMove(corner, { pointerId: 9, clientX: 0, clientY: 0 });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.pointerUp(corner, { pointerId: 7 });
    expect(container.querySelector('.gamepad-component')).not.toHaveClass('resizing');
  });

  it('is not a drag of the component', () => {
    const { container } = renderResizable([]);
    fireEvent.pointerDown(container.querySelector('.component-resize-handle.e')!, { pointerId: 1, clientX: 50, clientY: 25 });
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    container.querySelector('.gamepad-component')!.dispatchEvent(dragStart);
    expect(dragStart.defaultPrevented).toBe(true);
  });
});
