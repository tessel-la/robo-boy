import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PoseStampedSettings from './PoseStampedSettings';

const LABEL = 'Pose on /goal_pose';

describe('PoseStampedSettings', () => {
  it('sizes an arrow by default and an axes shape by its length', () => {
    const { rerender } = render(<PoseStampedSettings id="pose" topic="/goal_pose" onChange={vi.fn()} />);

    expect(screen.getByLabelText(`Shape for ${LABEL}`)).toHaveValue('arrow');
    expect(screen.getByLabelText(`Arrow length in metres for ${LABEL}`)).toHaveValue(1);
    expect(screen.getByLabelText(`Arrow width in metres for ${LABEL}`)).toHaveValue(0.1);
    expect(screen.queryByLabelText(`Axes length in metres for ${LABEL}`)).not.toBeInTheDocument();

    rerender(<PoseStampedSettings id="pose" topic="/goal_pose" onChange={vi.fn()} options={{ visualizationType: 'axes', axesSize: 0.8 }} />);
    expect(screen.getByLabelText(`Axes length in metres for ${LABEL}`)).toHaveValue(0.8);
    expect(screen.queryByLabelText(`Arrow length in metres for ${LABEL}`)).not.toBeInTheDocument();
  });

  it('shows the value in effect for a setting an earlier version switched off, and switches it on when edited', () => {
    const onChange = vi.fn();
    render(<PoseStampedSettings id="pose" topic="/goal_pose" onChange={onChange}
      options={{ scale: 3, scaleEnabled: false, color: '#ff0000', colorEnabled: false, arrowLength: 2, arrowDimensionsEnabled: false }} />);

    expect(screen.getByLabelText(`Scale for ${LABEL}`)).toHaveValue(1);
    expect(screen.getByLabelText(`Color for ${LABEL}`)).toHaveValue('#00ff00');
    expect(screen.getByLabelText(`Arrow length in metres for ${LABEL}`)).toHaveValue(1);

    fireEvent.change(screen.getByLabelText(`Scale for ${LABEL}`), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText(`Scale for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pose', { scale: 2, scaleEnabled: true });

    fireEvent.change(screen.getByLabelText(`Color for ${LABEL}`), { target: { value: '#0000ff' } });
    expect(onChange).toHaveBeenLastCalledWith('pose', { color: '#0000ff', colorEnabled: true });

    fireEvent.change(screen.getByLabelText(`Arrow length in metres for ${LABEL}`), { target: { value: '1.5' } });
    fireEvent.blur(screen.getByLabelText(`Arrow length in metres for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pose', { arrowLength: 1.5, arrowDimensionsEnabled: true });
  });

  it('switches the trail on and enables its length only while it is shown', () => {
    const onChange = vi.fn();
    const { rerender } = render(<PoseStampedSettings id="pose" topic="/goal_pose" onChange={onChange} />);

    expect(screen.getByLabelText(`Show trail for ${LABEL}`)).not.toBeChecked();
    expect(screen.getByLabelText(`Trail length in poses for ${LABEL}`)).toBeDisabled();

    fireEvent.click(screen.getByLabelText(`Show trail for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pose', { trailEnabled: true, showTrail: true });

    rerender(<PoseStampedSettings id="pose" topic="/goal_pose" onChange={onChange} options={{ trailEnabled: true, showTrail: true, maxTrailLength: 80 }} />);
    expect(screen.getByLabelText(`Trail length in poses for ${LABEL}`)).toHaveValue(80);
    fireEvent.change(screen.getByLabelText(`Trail length in poses for ${LABEL}`), { target: { value: '120.4' } });
    fireEvent.blur(screen.getByLabelText(`Trail length in poses for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pose', { maxTrailLength: 120 });
  });
});
