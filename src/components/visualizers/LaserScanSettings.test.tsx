import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as THREE from 'three';
import LaserScanSettings from './LaserScanSettings';

const LABEL = 'Laser scan on /scan';

describe('LaserScanSettings', () => {
  it('shows the defaults when nothing is saved', () => {
    render(<LaserScanSettings id="ls" topic="/scan" onChange={vi.fn()} />);

    expect(screen.getByLabelText(`Point size in pixels for ${LABEL}`)).toHaveValue(1);
    expect(screen.getByLabelText(`Color for ${LABEL}`)).toHaveValue('#0000ff');
    expect(screen.getByLabelText(`Minimum range in metres for ${LABEL}`)).toHaveValue(0);
    expect(screen.getByLabelText(`Maximum range in metres for ${LABEL}`)).toHaveValue(100);
  });

  it('shows a colour saved as a THREE.Color', () => {
    render(<LaserScanSettings id="ls" topic="/scan" onChange={vi.fn()} options={{ pointColor: new THREE.Color(0xff0000) }} />);

    expect(screen.getByLabelText(`Color for ${LABEL}`)).toHaveValue('#ff0000');
  });

  it('applies each change at once', () => {
    const onChange = vi.fn();
    render(<LaserScanSettings id="ls" topic="/scan" onChange={onChange}
      options={{ pointSize: 2, pointColor: '#00ff00', minRange: 0.5, maxRange: 20 }} />);

    fireEvent.change(screen.getByLabelText(`Point size in pixels for ${LABEL}`), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText(`Point size in pixels for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('ls', { pointSize: 3 });

    fireEvent.change(screen.getByLabelText(`Color for ${LABEL}`), { target: { value: '#abcdef' } });
    expect(onChange).toHaveBeenLastCalledWith('ls', { pointColor: '#abcdef' });

    fireEvent.change(screen.getByLabelText(`Maximum range in metres for ${LABEL}`), { target: { value: '12.5' } });
    fireEvent.keyDown(screen.getByLabelText(`Maximum range in metres for ${LABEL}`), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('ls', { maxRange: 12.5 });
  });

  it('keeps the minimum range below the maximum and ignores an empty entry', () => {
    const onChange = vi.fn();
    render(<LaserScanSettings id="ls" topic="/scan" onChange={onChange} options={{ minRange: 0.5, maxRange: 20 }} />);

    fireEvent.change(screen.getByLabelText(`Minimum range in metres for ${LABEL}`), { target: { value: '50' } });
    fireEvent.blur(screen.getByLabelText(`Minimum range in metres for ${LABEL}`));
    expect(onChange).toHaveBeenLastCalledWith('ls', { minRange: 20 });

    onChange.mockClear();
    fireEvent.change(screen.getByLabelText(`Minimum range in metres for ${LABEL}`), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText(`Minimum range in metres for ${LABEL}`));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`Minimum range in metres for ${LABEL}`)).toHaveValue(0.5);
  });
});
