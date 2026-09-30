import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { getPadSpatialControl, usePadSpatialControl } from './spatialControl';
import type { GamepadComponentConfig } from './types';
const config: GamepadComponentConfig = { id: 'drive', type: 'button', position: { x: 0, y: 0, width: 1, height: 1 } };
function Control({ end, revision = 0, disabled = false }: { end: () => void; revision?: number; disabled?: boolean }) {
  const element = useRef<HTMLButtonElement>(null);
  usePadSpatialControl(element, { start: () => {}, end }, disabled, { ...config, config: { pressedValue: revision } });
  return <button ref={element}>Drive</button>;
}
describe('shared Pad control lifetime', () => {
  it('releases a held command once when its configuration changes, using the original release handler', () => {
    const end = vi.fn(),
      replacement = vi.fn();
    const view = render(<Control end={end} />);
    const old = getPadSpatialControl(view.getByRole('button'))!;
    act(() => old.start!(0.5, 0.5));
    view.rerender(<Control end={replacement} revision={1} />);
    expect(end).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
    act(() => old.end!());
    expect(end).toHaveBeenCalledOnce();
    const next = getPadSpatialControl(view.getByRole('button'))!;
    act(() => next.start!(0.5, 0.5));
    view.unmount();
    expect(replacement).toHaveBeenCalledOnce();
  });
  it('keeps a hold through ordinary React updates and releases on disable', () => {
    const end = vi.fn(),
      nextEnd = vi.fn();
    const view = render(<Control end={end} />);
    const control = getPadSpatialControl(view.getByRole('button'))!;
    act(() => control.start!(0.5, 0.5));
    view.rerender(<Control end={nextEnd} />);
    expect(end).not.toHaveBeenCalled();
    expect(getPadSpatialControl(view.getByRole('button'))).toBe(control);
    view.rerender(<Control end={nextEnd} disabled />);
    expect(end).toHaveBeenCalledOnce();
    expect(nextEnd).not.toHaveBeenCalled();
    expect(getPadSpatialControl(view.getByRole('button'))).toBeNull();
    view.unmount();
    expect(end).toHaveBeenCalledOnce();
  });
  it('does not send a release for a control that was never pressed', () => {
    const end = vi.fn();
    const view = render(<Control end={end} />);
    view.unmount();
    expect(end).not.toHaveBeenCalled();
  });
});
