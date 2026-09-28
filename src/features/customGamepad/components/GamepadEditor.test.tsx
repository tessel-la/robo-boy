import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Ros } from 'roslib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GamepadEditor from './GamepadEditor';

const saveCustomGamepad = vi.fn(() => true);

vi.mock('../gamepadStorage', () => ({
  generateGamepadId: () => 'custom-new-gamepad',
  saveCustomGamepad: () => saveCustomGamepad(),
}));

vi.mock('./CustomGamepadLayout', () => ({
  default: ({
    layout,
    dropPreview,
  }: {
    layout: {
      name: string;
      gridSize: { width: number; height: number };
      components: Array<{ type: string; position: { x: number; y: number; width: number; height: number } }>;
    };
    dropPreview?: { x: number; y: number; width: number; height: number; isValid: boolean } | null;
  }) => (
    <div data-testid="editor-canvas">
      {layout.name}
      <div className="gamepad-grid">
        <div className="grid-background">
          {Array.from({ length: layout.gridSize.width * layout.gridSize.height }).map((_, index) => (
            <span className="grid-cell" key={index} />
          ))}
        </div>
      </div>
      <output data-testid="drop-position">
        {dropPreview ? `${dropPreview.x},${dropPreview.y},${dropPreview.width},${dropPreview.height}` : ''}
      </output>
      <output data-testid="drop-valid">{dropPreview ? String(dropPreview.isValid) : ''}</output>
      <output data-testid="components">
        {layout.components.map(c => `${c.type}@${c.position.x},${c.position.y},${c.position.width},${c.position.height}`).join(' ')}
      </output>
    </div>
  ),
}));

vi.mock('./ComponentPalette', () => ({
  default: ({
    contentOnly,
    onDragStart,
  }: {
    contentOnly?: boolean;
    onDragStart?: (componentType: string) => void;
  }) => (
    <div data-testid="component-gallery">
      {contentOnly ? 'contained gallery' : 'legacy gallery'}
      <button type="button" onClick={() => onDragStart?.('joystick')}>Drag joystick</button>
      <button type="button" onClick={() => onDragStart?.('physical-gamepad')}>Drag physical gamepad</button>
    </div>
  ),
}));

vi.mock('./GridSettingsMenu', () => ({
  default: ({ contentOnly }: { contentOnly?: boolean }) => (
    <div data-testid="layout-settings">{contentOnly ? 'contained settings' : 'legacy settings'}</div>
  ),
}));

vi.mock('./ComponentSettingsModal', () => ({
  default: () => null,
}));

describe('GamepadEditor tool panels', () => {
  beforeEach(() => {
    saveCustomGamepad.mockClear();
  });

  it('keeps editor tools beside the design canvas and switches them from the header', () => {
    render(
      <GamepadEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        ros={{} as Ros}
      />
    );

    const workspace = screen.getByTestId('editor-canvas').parentElement?.parentElement;
    expect(workspace).toHaveClass('editor-workspace', 'has-tools-panel');
    expect(screen.getByRole('complementary', { name: 'Components' }).parentElement).toBe(workspace);
    expect(screen.getByTestId('component-gallery')).toHaveTextContent('contained gallery');
    expect(screen.getByRole('button', { name: 'Components' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Layout settings' }));

    expect(screen.getByRole('complementary', { name: 'Layout settings' }).parentElement).toBe(workspace);
    expect(screen.getByTestId('layout-settings')).toHaveTextContent('contained settings');
    expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close editor tools' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(workspace).not.toHaveClass('has-tools-panel');
  });

  it('closes from the dedicated editor header control', () => {
    const onClose = vi.fn();
    render(<GamepadEditor isOpen onClose={onClose} onSave={vi.fn()} ros={{} as Ros} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close gamepad editor' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Lays the mocked grid's cells out 50px wide with a 4px gap, from (20, 100).
  const layOutCells = (columns: number) => {
    document.querySelectorAll<HTMLElement>('.grid-cell').forEach((cell, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
        bottom: 150 + row * 54, height: 50, left: 20 + column * 54, right: 70 + column * 54,
        top: 100 + row * 54, width: 50, x: 20 + column * 54, y: 100 + row * 54, toJSON: () => ({}),
      });
    });
  };

  it('fits a component larger than the free room into the space around the finger', () => {
    const initialLayout = {
      id: 'small', name: 'Small pad', gridSize: { width: 4, height: 3 }, cellSize: 80,
      components: [{ id: 'stick', type: 'joystick' as const, position: { x: 0, y: 0, width: 2, height: 3 } }],
      rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
      metadata: { created: '', modified: '', version: '1.0.0' },
    };
    render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros} initialLayout={initialLayout} />);
    layOutCells(4);

    // A 6x4 physical gamepad, over the free cell in column 3, row 1: it takes the 2x3 that is left.
    fireEvent.click(screen.getByRole('button', { name: 'Drag physical gamepad' }));
    fireEvent.touchMove(document, { touches: [{ identifier: 1, clientX: 205, clientY: 175 }] });
    expect(screen.getByTestId('drop-position')).toHaveTextContent('2,0,2,3');
    expect(screen.getByTestId('drop-valid')).toHaveTextContent('true');

    fireEvent.touchEnd(document, { changedTouches: [{ identifier: 1, clientX: 205, clientY: 175 }] });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@0,0,2,3 physical-gamepad@2,0,2,3');
  });

  it('does not place anything over another component', () => {
    render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros} initialLayout={{
      id: 'full', name: 'Full pad', gridSize: { width: 4, height: 3 }, cellSize: 80,
      components: [{ id: 'stick', type: 'joystick' as const, position: { x: 0, y: 0, width: 4, height: 3 } }],
      rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
      metadata: { created: '', modified: '', version: '1.0.0' },
    }} />);
    layOutCells(4);

    fireEvent.click(screen.getByRole('button', { name: 'Drag joystick' }));
    fireEvent.touchMove(document, { touches: [{ identifier: 1, clientX: 100, clientY: 150 }] });
    expect(screen.getByTestId('drop-valid')).toHaveTextContent('false');
    fireEvent.touchEnd(document, { changedTouches: [{ identifier: 1, clientX: 100, clientY: 150 }] });
    expect(screen.getByTestId('components')).toHaveTextContent(/^joystick@0,0,4,3$/);
  });

  it('aligns a touch drop preview with the rendered grid cells and centers it under the finger', () => {
    render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros} />);

    const cells = document.querySelectorAll<HTMLElement>('.grid-cell');
    cells.forEach((cell, index) => {
      const column = index % 8;
      const row = Math.floor(index / 8);
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue({
        bottom: 150 + row * 54,
        height: 50,
        left: 20 + column * 54,
        right: 70 + column * 54,
        top: 100 + row * 54,
        width: 50,
        x: 20 + column * 54,
        y: 100 + row * 54,
        toJSON: () => ({}),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Drag joystick' }));

    // Center of a 2x2 preview spanning columns 3-4 and rows 1-2.
    fireEvent.touchMove(document, {
      touches: [{ identifier: 1, clientX: 234, clientY: 206 }],
    });

    expect(screen.getByTestId('drop-position')).toHaveTextContent('3,1,2,2');
  });
});
