import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FirstPanelFlight, { ARRIVAL, flightKeyframes } from './FirstPanelFlight';

const BUTTON = { left: 560, top: 350, width: 140, height: 44 };
const TOOLBAR = { left: 624, top: 4, width: 32, height: 32 };
const position = (frame: Keyframe) => {
  const [x, y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(frame.transform))!.slice(1).map(Number);
  return { x: x + parseFloat(String(frame.width)) / 2, y: y + parseFloat(String(frame.height)) / 2 };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('flightKeyframes', () => {
  it('rounds the button up, glides on a gentle curve even when the buttons are stacked, and shrinks into the target', () => {
    const frames = flightKeyframes(BUTTON, TOOLBAR);
    const offsets = frames.map(frame => frame.offset as number);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect([offsets[0], offsets[offsets.length - 1]]).toEqual([0, 1]);

    expect(frames[0]).toMatchObject({ width: '140px', height: '44px', borderRadius: '7px' });
    expect(frames[1]).toMatchObject({ width: '44px', height: '44px', borderRadius: '50%' });

    // Both buttons are centred at x = 630 and x = 640; the path leaves that line, but not by much.
    const middle = position(frames[Math.floor(frames.length / 2)]);
    expect(Math.abs(middle.x - 635)).toBeGreaterThan(15);
    expect(Math.abs(middle.x - 635)).toBeLessThan(60);
    const arrival = frames.find(frame => Math.abs((frame.offset as number) - ARRIVAL) < 1e-9)!;
    expect(position(arrival)).toEqual({ x: 640, y: 20 });
    expect(frames[frames.length - 1]).toMatchObject({ opacity: 0 });
  });
});

describe('FirstPanelFlight', () => {
  it('lands at once when motion is reduced', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const onArrive = vi.fn(), onDone = vi.fn();
    render(<FirstPanelFlight from={BUTTON} to={TOOLBAR} icon={<svg />} label="Add panel" onArrive={onArrive} onDone={onDone} />);
    expect(onArrive).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
