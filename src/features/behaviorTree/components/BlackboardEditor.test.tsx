import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BlackboardEditor from './BlackboardEditor';

describe('BlackboardEditor', () => {
  it('adds typed variables and edits values without raw object JSON', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BlackboardEditor values={{ speed: 1 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Value for speed'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ speed: 2.5 }, { speed: 'int32' });

    fireEvent.change(screen.getByLabelText('New blackboard variable'), { target: { value: 'ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenLastCalledWith({ speed: 1, ready: false }, { speed: 'int32', ready: 'bool' });

    rerender(<BlackboardEditor values={{ ready: null }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Type for ready'), { target: { value: 'bool' } });
    expect(onChange).toHaveBeenLastCalledWith({ ready: false }, { ready: 'bool' });
  });

  it('creates typed ROS-compatible defaults without losing numeric precision metadata', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <BlackboardEditor values={{ measurement: 0 }} types={{ measurement: 'float64' }} onChange={onChange} />
    );
    expect(screen.getByLabelText('Type for measurement')).toHaveValue('float64');

    fireEvent.change(screen.getByLabelText('Type for measurement'), { target: { value: 'pose' } });
    expect(onChange).toHaveBeenLastCalledWith(
      { measurement: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
      { measurement: 'pose' }
    );

    rerender(<BlackboardEditor values={{ velocity: {} }} types={{ velocity: 'twist' }} onChange={onChange} />);
    expect(screen.getByLabelText('Type for velocity')).toHaveValue('twist');
  });

  it('renders live values as read-only controls', () => {
    render(<BlackboardEditor values={{ state: 'moving' }} readOnly onChange={vi.fn()} />);
    expect(screen.getByLabelText('Value for state')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });
});
