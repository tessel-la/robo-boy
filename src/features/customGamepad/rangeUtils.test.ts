import { describe, expect, it } from 'vitest';
import { getDynamicRangeStep, getStepPrecision, roundToStepPrecision } from './rangeUtils';

describe('dynamic gamepad ranges', () => {
  it('scales float steps with the configured range', () => {
    expect(getDynamicRangeStep(-1, 1)).toBe(0.002);
    expect(getDynamicRangeStep(-0.01, 0.01)).toBe(0.00002);
    expect(getDynamicRangeStep(-100, 100)).toBe(0.2);
  });

  it('keeps integer controls on whole-number steps', () => {
    expect(getDynamicRangeStep(-0.01, 0.01, true)).toBe(1);
  });

  it('preserves the precision required by small dynamic steps', () => {
    expect(getStepPrecision(0.00002)).toBe(5);
    expect(roundToStepPrecision(0.001234, 0.00002)).toBe(0.00123);
  });
});
