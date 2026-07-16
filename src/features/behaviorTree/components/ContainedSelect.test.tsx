import { describe, expect, it } from 'vitest';
import { computeContainedSelectFrame } from './ContainedSelect';

describe('computeContainedSelectFrame', () => {
  it('stays inside a shifted visual viewport when the mobile keyboard is open', () => {
    const frame = computeContainedSelectFrame(
      { left: 340, right: 390, top: 420, bottom: 450, width: 50 },
      { left: 20, top: 300, width: 360, height: 180 }
    );
    const left = Number(frame.left);
    const top = Number(frame.top);
    const width = Number(frame.width);
    const height = Number(frame.maxHeight);

    expect(left).toBeGreaterThanOrEqual(28);
    expect(left + width).toBeLessThanOrEqual(372);
    expect(top).toBeGreaterThanOrEqual(308);
    expect(top + height).toBeLessThanOrEqual(472);
  });

  it('shrinks rather than overflowing an extremely short viewport', () => {
    const frame = computeContainedSelectFrame(
      { left: 10, right: 210, top: 36, bottom: 66, width: 200 },
      { left: 0, top: 0, width: 240, height: 100 }
    );
    expect(Number(frame.left) + Number(frame.width)).toBeLessThanOrEqual(232);
    expect(Number(frame.top) + Number(frame.maxHeight)).toBeLessThanOrEqual(92);
  });
});
