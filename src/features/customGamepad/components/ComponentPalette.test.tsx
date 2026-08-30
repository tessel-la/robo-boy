import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ComponentPalette from './ComponentPalette';

vi.mock('./ButtonComponent', () => ({ default: () => <span /> }));
vi.mock('./JoystickComponent', () => ({ default: () => <span /> }));
vi.mock('./DPadComponent', () => ({ default: () => <span /> }));
vi.mock('./ToggleComponent', () => ({ default: () => <span /> }));
vi.mock('./SliderComponent', () => ({ default: () => <span /> }));
vi.mock('./CameraComponent', () => ({ default: () => <span /> }));
vi.mock('./PlotComponent', () => ({ default: () => <span /> }));
vi.mock('./HeartbeatComponent', () => ({ default: () => <span /> }));

describe('ComponentPalette touch gestures', () => {
  it('allows scrolling over cards and starts touch dragging only from the grip', () => {
    const onComponentSelect = vi.fn();
    const onDragStart = vi.fn();
    render(
      <ComponentPalette
        contentOnly
        selectedComponent={null}
        onComponentSelect={onComponentSelect}
        onDragStart={onDragStart}
      />
    );

    const joystickCard = screen.getByTitle('Drag to add Joystick');
    fireEvent.touchStart(joystickCard, {
      touches: [{ identifier: 1, clientX: 30, clientY: 100 }],
    });
    fireEvent.touchMove(joystickCard, {
      touches: [{ identifier: 1, clientX: 30, clientY: 50 }],
    });
    fireEvent.touchEnd(joystickCard, { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });

    expect(onComponentSelect).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();

    const joystickGrip = screen.getByRole('button', { name: 'Drag Joystick' });
    fireEvent.touchStart(joystickGrip, {
      touches: [{ identifier: 2, clientX: 30, clientY: 100 }],
    });
    fireEvent.touchMove(joystickGrip, {
      touches: [{ identifier: 2, clientX: 40, clientY: 110 }],
    });

    expect(onComponentSelect).toHaveBeenCalledWith('joystick');
    expect(onDragStart).toHaveBeenCalledWith('joystick');
  });
});
