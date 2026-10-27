import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PointCloudSettings from './PointCloudSettings';

const LABEL = 'Point cloud on /points';

describe('PointCloudSettings', () => {
  it('shows the defaults when nothing is saved', () => {
    render(<PointCloudSettings id="pc" topic="/points" onChange={vi.fn()} />);

    expect(screen.getByLabelText(`Point size in metres for ${LABEL}`)).toHaveValue(0.05);
    expect(screen.getByLabelText(`Maximum points for ${LABEL}`)).toHaveValue(200000);
    expect(screen.getByLabelText(`Color for ${LABEL}`)).toHaveValue('#00ff00');
  });

  it('applies each change at once and switches the edited value on for the viewer', () => {
    const onChange = vi.fn();
    render(<PointCloudSettings id="pc" topic="/points" onChange={onChange}
      options={{ pointSize: 0.02, color: '#ff8722', maxPoints: 50000, pointSizeEnabled: false, colorEnabled: false }} />);

    expect(screen.getByLabelText(`Point size in metres for ${LABEL}`)).toHaveValue(0.02);

    fireEvent.change(screen.getByLabelText(`Point size in metres for ${LABEL}`), { target: { value: '0.1' } });
    fireEvent.blur(screen.getByLabelText(`Point size in metres for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pc', { pointSize: 0.1, pointSizeEnabled: true });

    fireEvent.change(screen.getByLabelText(`Maximum points for ${LABEL}`), { target: { value: '12345.6' } });
    fireEvent.keyDown(screen.getByLabelText(`Maximum points for ${LABEL}`), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('pc', { maxPoints: 12346, maxPointsEnabled: true });

    fireEvent.change(screen.getByLabelText(`Color for ${LABEL}`), { target: { value: '#123456' } });
    expect(onChange).toHaveBeenLastCalledWith('pc', { color: '#123456', colorEnabled: true });
  });

  it('keeps typed values inside the slider range', () => {
    const onChange = vi.fn();
    render(<PointCloudSettings id="pc" topic="/points" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(`Maximum points for ${LABEL}`), { target: { value: '5000000' } });
    fireEvent.blur(screen.getByLabelText(`Maximum points for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('pc', { maxPoints: 1000000, maxPointsEnabled: true });
  });
});
