import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameBoyLayout from './GameBoyLayout';

const publish = vi.fn();
const advertise = vi.fn();
const unadvertise = vi.fn();

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

describe('GameBoyLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('advertises /joy and publishes button presses', () => {
    render(<GameBoyLayout ros={{} as any} />);

    expect(advertise).toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByText('A'));

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        axes: [],
        buttons: [0, 0, 0, 0, 1, 0, 0, 0],
      })
    );
    expect(screen.getByText('A')).toHaveClass('active');
  });

  it('publishes all buttons released before unadvertising on unmount', () => {
    const { unmount } = render(<GameBoyLayout ros={{} as any} />);

    fireEvent.pointerDown(screen.getByText('B'));
    publish.mockClear();

    unmount();

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ buttons: Array(8).fill(0) }));
    expect(unadvertise).toHaveBeenCalled();
  });
});
