import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PhysicalGamepadSettings from './PhysicalGamepadSettings';

vi.mock('./RosEventOperationsEditor', () => ({
  default: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          press: { kind: 'topic', name: '/pressed', messageType: 'std_msgs/msg/Bool', payload: { data: true } },
        })
      }
    >
      Configure selected
    </button>
  ),
}));

describe('PhysicalGamepadSettings', () => {
  it('offers all standard buttons and saves operations under the selected control', () => {
    const onBindingsChange = vi.fn();
    render(
      <PhysicalGamepadSettings
        profile="playstation"
        deadzone={0.08}
        bindings={{}}
        ros={null}
        onProfileChange={vi.fn()}
        onPreferredIndexChange={vi.fn()}
        onDeadzoneChange={vi.fn()}
        onBindingsChange={onBindingsChange}
      />
    );

    const picker = screen.getByRole('list', { name: 'Physical controller buttons' });
    expect(within(picker).getAllByRole('button')).toHaveLength(17);
    fireEvent.click(within(picker).getByRole('button', { name: '○' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure selected' }));

    expect(onBindingsChange).toHaveBeenCalledWith({
      'face-right': {
        press: { kind: 'topic', name: '/pressed', messageType: 'std_msgs/msg/Bool', payload: { data: true } },
      },
    });
  });
});
