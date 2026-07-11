import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BlackboardEditor from './BlackboardEditor';

describe('BlackboardEditor', () => {
  it('adds typed variables and edits values without raw object JSON', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BlackboardEditor values={{ speed: 1 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Value for speed'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ speed: 2.5 });

    fireEvent.change(screen.getByLabelText('New blackboard variable'), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenLastCalledWith({ speed: 1, ready: null });

    rerender(<BlackboardEditor values={{ ready: null }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Type for ready'), { target: { value: 'boolean' } });
    expect(onChange).toHaveBeenLastCalledWith({ ready: false });
  });

  it('renders live values as read-only controls', () => {
    render(<BlackboardEditor values={{ state: 'moving' }} readOnly onChange={vi.fn()} />);
    expect(screen.getByLabelText('Value for state')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});
