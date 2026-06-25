import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StandardPadLayout from './StandardPadLayout';

const publish = vi.fn();
const advertise = vi.fn();
const unadvertise = vi.fn();
const joystickProps: any[] = [];

vi.mock('roslib', () => ({
  default: {
    Message: vi.fn(function (this: any, data) {
      return data;
    }),
    Topic: vi.fn(function () {
      return { advertise, publish, unadvertise };
    }),
  },
}));

vi.mock('react-joystick-component', () => ({
  Joystick: (props: any) => {
    joystickProps.push(props);
    const index = joystickProps.length - 1;
    return (
      <button
        type="button"
        data-testid={`joystick-${index}`}
        data-base-color={props.baseColor}
        data-stick-color={props.stickColor}
        onClick={() => props.move({ x: 25, y: -50 })}
        onDoubleClick={() => props.stop()}
      />
    );
  },
}));

describe('StandardPadLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joystickProps.length = 0;
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    document.documentElement.style.setProperty('--secondary-color', '#123456');
    document.documentElement.style.setProperty('--primary-color', '#abcdef');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('--secondary-color');
    document.documentElement.style.removeProperty('--primary-color');
  });

  it('publishes normalized axes for left and right joysticks', () => {
    render(<StandardPadLayout ros={{} as any} />);

    expect(advertise).toHaveBeenCalled();
    let [leftJoystick, rightJoystick] = screen.getAllByRole('button');
    expect(leftJoystick).toHaveAttribute('data-base-color', '#123456');

    fireEvent.click(leftJoystick);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ axes: [0.5, -1, 0, 0], buttons: [] }));

    [, rightJoystick] = screen.getAllByRole('button');
    fireEvent.click(rightJoystick);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ axes: [0.5, -1, 0.5, -1], buttons: [] }));

    [leftJoystick] = screen.getAllByRole('button');
    fireEvent.doubleClick(leftJoystick);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ axes: [0, 0, 0.5, -1], buttons: [] }));
  });

  it('sends a stop command and unadvertises on unmount', () => {
    const { unmount } = render(<StandardPadLayout ros={{} as any} />);

    fireEvent.click(screen.getAllByRole('button')[1]);
    publish.mockClear();

    unmount();

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ axes: [0, 0, 0, 0] }));
    expect(unadvertise).toHaveBeenCalled();
  });

  it('updates joystick colors when the document theme changes', async () => {
    vi.useRealTimers();
    render(<StandardPadLayout ros={{} as any} />);

    act(() => {
      document.documentElement.style.setProperty('--secondary-color', '#654321');
      document.documentElement.style.setProperty('--primary-color', '#fedcba');
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    await waitFor(() => {
      const [leftJoystick] = screen.getAllByRole('button');
      expect(leftJoystick).toHaveAttribute('data-base-color', '#654321');
      expect(leftJoystick).toHaveAttribute('data-stick-color', '#fedcba');
    });
  });
});
