import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ValueControl from './ValueControl';

describe('ValueControl', () => {
  it('does not overwrite a value while it is being typed', () => {
    const onChange = vi.fn();
    render(
      <ValueControl
        label="Slider Min"
        value={-1}
        step={0.002}
        onChange={onChange}
      />
    );

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '-0.123' } });

    expect(input).toHaveValue(-0.123);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(-0.123);
  });
});
