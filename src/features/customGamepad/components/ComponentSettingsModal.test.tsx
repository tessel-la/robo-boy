import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GamepadComponentConfig } from '../types';
import ComponentSettingsModal from './ComponentSettingsModal';

const slider: GamepadComponentConfig = {
  id: 'slider-1',
  type: 'slider',
  label: 'Throttle',
  position: { x: 1, y: 1, width: 2, height: 1 },
  action: { topic: '/throttle', messageType: 'std_msgs/Float32', field: 'data' },
  config: { min: -1, max: 1, step: 0.1, orientation: 'horizontal' },
};

describe('ComponentSettingsModal', () => {
  it('keeps configuration behavior intact while exposing the existing slider parameters', () => {
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(<ComponentSettingsModal isOpen component={slider} onClose={onClose} onSave={onSave} />);

    expect(screen.getByRole('dialog', { name: 'Configure Slider' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Display label'), { target: { value: 'Speed' } });
    fireEvent.change(screen.getByLabelText('Custom topic'), { target: { value: '/drive/speed' } });

    const minimum = screen.getByRole('spinbutton', { name: 'Minimum value' });
    fireEvent.change(minimum, { target: { value: '-5' } });
    fireEvent.blur(minimum);

    const maximum = screen.getByRole('spinbutton', { name: 'Maximum value' });
    fireEvent.change(maximum, { target: { value: '5' } });
    fireEvent.blur(maximum);

    const step = screen.getByRole('spinbutton', { name: 'Step size' });
    fireEvent.change(step, { target: { value: '0.25' } });
    fireEvent.blur(step);

    fireEvent.change(screen.getByLabelText('Orientation'), { target: { value: 'vertical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'slider-1',
        label: 'Speed',
        action: { topic: '/drive/speed', messageType: 'std_msgs/Float32', field: 'data' },
        config: { min: -5, max: 5, step: 0.25, orientation: 'vertical' },
      })
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
