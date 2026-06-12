import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RangeSlider from './RangeSlider';

describe('RangeSlider', () => {
  it('accepts typed selected-range values', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        min={-1}
        max={1}
        step={0.002}
        minValue={-0.5}
        maxValue={0.5}
        onChange={onChange}
      />
    );

    const minimum = screen.getByRole('spinbutton', { name: 'Selected range minimum' });
    fireEvent.change(minimum, { target: { value: '-0.123' } });
    fireEvent.blur(minimum);

    expect(onChange).toHaveBeenLastCalledWith({ min: -0.123, max: 0.5 });
    expect(minimum).toHaveValue(-0.123);
  });

  it('clamps typed values so the selected range remains valid', () => {
    const onChange = vi.fn();
    render(
      <RangeSlider
        min={-1}
        max={1}
        step={0.01}
        minValue={-0.5}
        maxValue={0.5}
        onChange={onChange}
      />
    );

    const minimum = screen.getByRole('spinbutton', { name: 'Selected range minimum' });
    fireEvent.change(minimum, { target: { value: '0.8' } });
    fireEvent.keyDown(minimum, { key: 'Enter' });

    expect(onChange).toHaveBeenLastCalledWith({ min: 0.49, max: 0.5 });
    expect(minimum).toHaveValue(0.49);
  });
});
