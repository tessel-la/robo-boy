import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NodeNameEditor from './NodeNameEditor';

describe('NodeNameEditor', () => {
  it('trims and saves a custom node name', () => {
    const onSave = vi.fn();

    render(
      <NodeNameEditor
        initialName="/navigate_to_pose"
        defaultName="/navigate_to_pose"
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Node name'), {
      target: { value: '  Navigate home  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(onSave).toHaveBeenCalledWith('Navigate home');
  });

  it('prevents empty names and can restore the resource default', () => {
    render(
      <NodeNameEditor initialName="Navigate home" defaultName="/navigate_to_pose" onSave={vi.fn()} onClose={vi.fn()} />
    );

    const input = screen.getByLabelText('Node name');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(input).toHaveValue('/navigate_to_pose');
  });
});
