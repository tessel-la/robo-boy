import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.useRealTimers());

  it('allows scrolling over cards and starts touch dragging after holding a card', () => {
    vi.useFakeTimers();
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

    const joystickCard = screen.getByTitle('Press and hold to drag Joystick');
    fireEvent.touchStart(joystickCard, {
      touches: [{ identifier: 1, clientX: 30, clientY: 100 }],
    });
    fireEvent.touchMove(joystickCard, {
      touches: [{ identifier: 1, clientX: 30, clientY: 50 }],
    });
    fireEvent.touchEnd(joystickCard, { changedTouches: [{ identifier: 1, clientX: 30, clientY: 50 }] });

    expect(onComponentSelect).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.touchStart(joystickCard, {
      touches: [{ identifier: 2, clientX: 30, clientY: 100 }],
    });

    expect(joystickCard).toHaveClass('is-holding');
    expect(onDragStart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(419));
    expect(onDragStart).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(onComponentSelect).toHaveBeenCalledWith('joystick');
    expect(onDragStart).toHaveBeenCalledWith('joystick');
    expect(joystickCard).not.toHaveClass('is-holding');
  });

  it('cancels the hold indicator when the finger moves before activation', () => {
    vi.useFakeTimers();
    const onDragStart = vi.fn();
    render(
      <ComponentPalette
        contentOnly
        selectedComponent={null}
        onComponentSelect={vi.fn()}
        onDragStart={onDragStart}
      />
    );

    const joystickCard = screen.getByTitle('Press and hold to drag Joystick');
    fireEvent.touchStart(joystickCard, {
      touches: [{ identifier: 3, clientX: 30, clientY: 100 }],
    });
    fireEvent.touchMove(joystickCard, {
      touches: [{ identifier: 3, clientX: 45, clientY: 100 }],
    });
    act(() => vi.advanceTimersByTime(420));

    expect(joystickCard).not.toHaveClass('is-holding');
    expect(onDragStart).not.toHaveBeenCalled();
  });
});
