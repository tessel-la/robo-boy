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
    selectedComponentId,
    onComponentSelect,
  }: {
    selectedComponentId?: string | null;
    onComponentSelect?: (id: string) => void;
    layout: {
      name: string;
      gridSize: { width: number; height: number };
      components: Array<{ id: string; type: string; position: { x: number; y: number; width: number; height: number } }>;
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
      <output data-testid="selected">{selectedComponentId ?? ''}</output>
      <output data-testid="grid-size">{`${layout.gridSize.width}x${layout.gridSize.height}`}</output>
      <button type="button" onClick={() => onComponentSelect?.(layout.components[0]?.id)}>Select first component</button>
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
    onComponentSelect,
  }: {
    contentOnly?: boolean;
    onDragStart?: (componentType: string) => void;
    onComponentSelect?: (componentType: string) => void;
  }) => (
    <div data-testid="component-gallery">
      {contentOnly ? 'contained gallery' : 'legacy gallery'}
      <button type="button" onClick={() => onDragStart?.('joystick')}>Drag joystick</button>
      <button type="button" onClick={() => onDragStart?.('physical-gamepad')}>Drag physical gamepad</button>
      <button type="button" onClick={() => onComponentSelect?.('button')}>Pick button</button>
    </div>
  ),
}));

vi.mock('./GridSettingsMenu', () => ({
  default: ({
    contentOnly,
    minGridWidth,
    minGridHeight,
    onGridSizeChange,
  }: {
    contentOnly?: boolean;
    minGridWidth?: number;
    minGridHeight?: number;
    onGridSizeChange?: (width: number, height: number) => void;
  }) => (
    <div data-testid="layout-settings">
      {contentOnly ? 'contained settings' : 'legacy settings'}
      <output data-testid="grid-floor">{`${minGridWidth}x${minGridHeight}`}</output>
      <button type="button" onClick={() => onGridSizeChange?.(1, 1)}>Shrink grid</button>
    </div>
  ),
}));

vi.mock('./ComponentSettingsModal', () => ({
  default: () => null,
}));

// jsdom has no DragEvent; the editor only reads a drop's position and its dataTransfer.
class TestDragEvent extends MouseEvent {
  dataTransfer: DataTransfer | null;
  constructor(type: string, init: DragEventInit = {}) {
    super(type, init);
    this.dataTransfer = init.dataTransfer ?? null;
  }
}
const installDragEvent = () => { (window as any).DragEvent = TestDragEvent; };
const fakeDataTransfer = (data: string) => ({ getData: () => data, setData: vi.fn(), dropEffect: 'none' }) as unknown as DataTransfer;

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

  const smallPad = (components: Array<{ id: string; type: 'joystick' | 'button'; position: { x: number; y: number; width: number; height: number } }>) => ({
    id: 'small', name: 'Small pad', gridSize: { width: 4, height: 3 }, cellSize: 80, components,
    rosConfig: { defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/Joy' },
    metadata: { created: '', modified: '', version: '1.0.0' },
  });

  it('drops a component from the gallery with the mouse at the size that fits', () => {
    installDragEvent();
    const { container } = render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros}
      initialLayout={smallPad([{ id: 'stick', type: 'joystick', position: { x: 0, y: 0, width: 2, height: 3 } }])} />);
    layOutCells(4);
    const designArea = container.querySelector('.design-area')!;

    fireEvent.click(screen.getByRole('button', { name: 'Drag physical gamepad' }));
    fireEvent.dragOver(designArea, { clientX: 205, clientY: 175, dataTransfer: fakeDataTransfer('') });
    expect(screen.getByTestId('drop-position')).toHaveTextContent('2,0,2,3');

    fireEvent.drop(designArea, { clientX: 205, clientY: 175, dataTransfer: fakeDataTransfer('') });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@0,0,2,3 physical-gamepad@2,0,2,3');
    expect(screen.getByTestId('drop-position')).toBeEmptyDOMElement();
  });

  it('moves a component dropped from the grid, keeping its size, and never onto another one', () => {
    installDragEvent();
    const { container } = render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros}
      initialLayout={smallPad([
        { id: 'stick', type: 'joystick', position: { x: 0, y: 0, width: 2, height: 2 } },
        { id: 'knob', type: 'button', position: { x: 3, y: 0, width: 1, height: 1 } },
      ])} />);
    layOutCells(4);
    const designArea = container.querySelector('.design-area')!;

    // Nothing started the drag here: the drop names the component itself.
    fireEvent.drop(designArea, { clientX: 150, clientY: 210, dataTransfer: fakeDataTransfer('stick') });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@1,1,2,2 button@3,0,1,1');

    // Over the button: the stick stays where it is.
    fireEvent.drop(designArea, { clientX: 205, clientY: 150, dataTransfer: fakeDataTransfer('stick') });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@1,1,2,2 button@3,0,1,1');

    // A new component named by the drop is fitted like any other.
    fireEvent.drop(designArea, { clientX: 45, clientY: 125, dataTransfer: fakeDataTransfer('button') });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@1,1,2,2 button@3,0,1,1 button@0,0,1,1');
  });

  it('places a picked component where the grid is tapped, and a tap on the empty grid clears the selection', () => {
    const { container } = render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros}
      initialLayout={smallPad([{ id: 'stick', type: 'joystick', position: { x: 0, y: 0, width: 2, height: 3 } }])} />);
    layOutCells(4);
    const designArea = container.querySelector('.design-area')!;

    fireEvent.click(screen.getByRole('button', { name: 'Pick button' }));
    fireEvent.click(designArea, { clientX: 205, clientY: 230 });
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@0,0,2,3 button@3,2,1,1');
    expect(screen.getByTestId('selected')).not.toBeEmptyDOMElement();

    fireEvent.click(designArea, { clientX: 150, clientY: 125 });
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
    expect(screen.getByTestId('components')).toHaveTextContent('joystick@0,0,2,3 button@3,2,1,1');
  });

  it('keeps the grid around its components when it is made smaller', () => {
    render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros}
      initialLayout={smallPad([{ id: 'stick', type: 'joystick', position: { x: 1, y: 0, width: 2, height: 2 } }])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Layout settings' }));
    expect(screen.getByTestId('grid-floor')).toHaveTextContent('3x2');

    fireEvent.click(screen.getByRole('button', { name: 'Shrink grid' }));
    expect(screen.getByTestId('grid-size')).toHaveTextContent('3x2');
  });

  it('places by the grid box itself before its cells have been laid out', () => {
    installDragEvent();
    const { container } = render(<GamepadEditor isOpen onClose={vi.fn()} onSave={vi.fn()} ros={{} as Ros} />);
    vi.spyOn(container.querySelector('.gamepad-grid')!, 'getBoundingClientRect').mockReturnValue({
      bottom: 316, height: 216, left: 20, right: 452, top: 100, width: 432, x: 20, y: 100, toJSON: () => ({}),
    });
    const designArea = container.querySelector('.design-area')!;

    fireEvent.click(screen.getByRole('button', { name: 'Drag joystick' }));
    // 54px cells: 3.6 columns and 1.6 rows in.
    fireEvent.dragOver(designArea, { clientX: 20 + 54 * 3.6, clientY: 100 + 54 * 1.6, dataTransfer: fakeDataTransfer('') });
    expect(screen.getByTestId('drop-position')).toHaveTextContent('3,1,2,2');

    // Leaving the design area takes the preview away; ending the drag forgets it.
    fireEvent.dragLeave(designArea, { clientX: -10, clientY: -10 });
    expect(screen.getByTestId('drop-position')).toBeEmptyDOMElement();
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
