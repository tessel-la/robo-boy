import { describe, expect, it } from 'vitest';
import {
  buildFieldMessage,
  clampToStep,
  coerceForType,
  describeRawValue,
  formatValue,
  fractionOf,
  levelOf,
  matchState,
  rangeOf,
  stdScalarType,
  toDisplayNumber,
  toNumber,
} from './padValues';

describe('padValues', () => {
  it('reads numbers from numbers, booleans and numeric text only', () => {
    expect(toNumber(2.5)).toBe(2.5);
    expect(toNumber(true)).toBe(1);
    expect(toNumber(false)).toBe(0);
    expect(toNumber(' 12 ')).toBe(12);
    expect(toNumber('IDLE')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber({ data: 1 })).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  it('scales and offsets a field into the shown value', () => {
    expect(toDisplayNumber(0.42, { scale: 100 })).toBeCloseTo(42);
    expect(toDisplayNumber(300, { offset: -273.15 })).toBeCloseTo(26.85);
    expect(toDisplayNumber('text', { scale: 100 })).toBeNull();
  });

  it('keeps a range usable whatever it is given', () => {
    expect(rangeOf({ min: -1, max: 1 })).toEqual({ min: -1, max: 1 });
    expect(rangeOf({})).toEqual({ min: 0, max: 100 });
    expect(rangeOf({ min: 10, max: 0 })).toEqual({ min: 0, max: 10 });
    expect(rangeOf({ min: 5, max: 5 })).toEqual({ min: 5, max: 6 });
    expect(fractionOf(150, { min: 0, max: 100 })).toBe(1);
    expect(fractionOf(-5, { min: 0, max: 100 })).toBe(0);
    expect(fractionOf(25, { min: 0, max: 100 })).toBe(0.25);
  });

  it('formats with set decimals, or as many as the range or the value needs', () => {
    expect(formatValue(12.345, { decimals: 1 })).toBe('12.3');
    expect(formatValue(42.4, {}, { min: 0, max: 100 })).toBe('42');
    expect(formatValue(0.1234, {}, { min: -1, max: 1 })).toBe('0.12');
    expect(formatValue(0.1234)).toBe('0.123');
    expect(formatValue(1234.5)).toBe('1235');
    expect(formatValue(-0.001, { decimals: 2 })).toBe('0.00');
    expect(formatValue(null)).toBe('—');
  });

  it('crosses thresholds upward by default and downward when asked', () => {
    const hot = { warnAt: 60, alarmAt: 80 };
    expect(levelOf(50, hot)).toBe('normal');
    expect(levelOf(60, hot)).toBe('warning');
    expect(levelOf(95, hot)).toBe('alarm');
    const battery = { warnAt: 30, alarmAt: 15, alertBelow: true };
    expect(levelOf(50, battery)).toBe('normal');
    expect(levelOf(20, battery)).toBe('warning');
    expect(levelOf(15, battery)).toBe('alarm');
    expect(levelOf(null, battery)).toBe('normal');
  });

  it('matches states by text, number and truth', () => {
    const mappings = [
      { value: 'IDLE', label: 'Idle', tone: 'neutral' as const },
      { value: '3', label: 'Charging', tone: 'info' as const },
      { value: 'true', label: 'Engaged', tone: 'error' as const },
    ];
    expect(matchState('idle', mappings)?.label).toBe('Idle');
    expect(matchState(3, mappings)?.label).toBe('Charging');
    expect(matchState(3.0, mappings)?.label).toBe('Charging');
    expect(matchState(true, mappings)?.label).toBe('Engaged');
    expect(matchState(1, mappings)?.label).toBe('Engaged');
    expect(matchState('RUNNING', mappings)).toBeUndefined();
    expect(matchState(undefined, mappings)).toBeUndefined();
    expect(describeRawValue('  RUNNING ')).toBe('RUNNING');
    expect(describeRawValue([1, 2])).toBe('[2 values]');
  });

  it('knows the std_msgs scalars in both spellings', () => {
    expect(stdScalarType('std_msgs/Float64')).toBe('float64');
    expect(stdScalarType('std_msgs/msg/Int32')).toBe('int32');
    expect(stdScalarType('std_msgs/msg/Bool')).toBe('bool');
    expect(stdScalarType('std_msgs/msg/String')).toBeUndefined();
    expect(stdScalarType('geometry_msgs/msg/Twist')).toBeUndefined();
  });

  it('builds the message a setpoint sends, typed for its field', () => {
    expect(buildFieldMessage('std_msgs/msg/Float64', 'data', 1.25)).toEqual({ data: 1.25 });
    expect(buildFieldMessage('std_msgs/Int32', 'data', 2.6)).toEqual({ data: 3 });
    expect(buildFieldMessage('std_msgs/msg/UInt8', 'data', -4)).toEqual({ data: 0 });
    expect(buildFieldMessage('std_msgs/msg/Bool', 'data', 1)).toEqual({ data: true });
    expect(buildFieldMessage('geometry_msgs/msg/Twist', 'linear.x', 0.5, 'float64')).toEqual({ linear: { x: 0.5 } });
    expect(buildFieldMessage('custom/msg/Targets', 'values[2]', 7, 'int16')).toEqual({ values: [0, 0, 7] });
    expect(coerceForType(2.4, 'int64[]')).toBe(2);
  });

  it('keeps a setpoint in its range and on its step', () => {
    expect(clampToStep(0.26, { min: 0, max: 1 }, 0.1)).toBe(0.3);
    expect(clampToStep(12, { min: 0, max: 10 }, 0.5)).toBe(10);
    expect(clampToStep(-3, { min: 0, max: 10 })).toBe(0);
    expect(clampToStep(7, { min: 1, max: 10 }, 3)).toBe(7);
  });
});
