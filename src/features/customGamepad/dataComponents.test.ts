import { describe, expect, it } from 'vitest';
import { describeMismatch, isDataComponentType, validateDataComponent } from './dataComponents';
import { commonFields } from './rosMessageUtils';

const errors = (issues: ReturnType<typeof validateDataComponent>) => issues.filter(i => i.level === 'error').map(i => i.message);
const warnings = (issues: ReturnType<typeof validateDataComponent>) => issues.filter(i => i.level === 'warning').map(i => i.message);

describe('dataComponents', () => {
  const battery = commonFields('sensor_msgs/msg/BatteryState');
  const twist = commonFields('geometry_msgs/msg/Twist');

  it('tells value components from the rest', () => {
    expect(isDataComponentType('gauge')).toBe(true);
    expect(isDataComponentType('text')).toBe(true);
    expect(isDataComponentType('plot')).toBe(false);
    expect(isDataComponentType(undefined)).toBe(false);
  });

  it('accepts a numeric field of any message for a gauge', () => {
    const issues = validateDataComponent(
      'gauge',
      { topic: '/battery', messageType: 'sensor_msgs/msg/BatteryState', field: 'percentage' },
      { min: 0, max: 100, scale: 100, warnAt: 30, alarmAt: 15, alertBelow: true },
      battery
    );
    expect(issues).toEqual([]);
  });

  it('needs a topic, a type and a field', () => {
    expect(errors(validateDataComponent('readout', { topic: '', messageType: '', field: '' }))).toEqual([
      'Choose a topic.',
      'Enter the topic\'s message type.',
      'Choose the field to show.',
    ]);
    expect(errors(validateDataComponent('setpoint', { topic: '/t', messageType: 'std_msgs/msg/Float64', field: '' })))
      .toEqual(['Choose the field to send.']);
  });

  it('refuses a field of the wrong kind and a field that holds a message', () => {
    const text = validateDataComponent('gauge', { topic: '/s', messageType: 'std_msgs/msg/String', field: 'data' }, {}, commonFields('std_msgs/msg/String'));
    expect(errors(text)).toEqual(['“data” is text; this component needs a number.']);
    const nested = validateDataComponent('readout', { topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', field: 'linear' }, {}, twist);
    expect(errors(nested)[0]).toMatch(/“linear” holds several values; choose one of them, such as “linear.x”/);
    const state = validateDataComponent('state', { topic: '/s', messageType: 'std_msgs/msg/String', field: 'data' }, { stateMappings: [] }, commonFields('std_msgs/msg/String'));
    expect(errors(state)).toEqual([]);
  });

  it('only warns about a path the message type is not known to have', () => {
    const issues = validateDataComponent('gauge', { topic: '/b', messageType: 'sensor_msgs/msg/BatteryState', field: 'cell_voltage[3]' }, {}, battery);
    expect(errors(issues)).toEqual([]);
    expect(warnings(issues)[0]).toMatch(/has no field “cell_voltage\[3\]”/);
    const joy = commonFields('sensor_msgs/msg/Joy');
    expect(validateDataComponent('readout', { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes[12]' }, {}, joy)).toEqual([]);
  });

  it('checks ranges, thresholds and formatting', () => {
    const at = { topic: '/t', messageType: 'std_msgs/msg/Float64', field: 'data' };
    expect(errors(validateDataComponent('level', at, { min: 10, max: 10 }))).toContain('The minimum must be lower than the maximum.');
    expect(errors(validateDataComponent('gauge', at, { warnAt: 80, alarmAt: 60 }))).toContain('The alarm threshold must be at or above the warning one.');
    expect(errors(validateDataComponent('gauge', at, { warnAt: 20, alarmAt: 30, alertBelow: true })))
      .toContain('Counting down, the alarm threshold must be at or below the warning one.');
    expect(warnings(validateDataComponent('gauge', at, { min: 0, max: 100, alarmAt: 120 }))[0]).toMatch(/outside the 0–100 range/);
    expect(errors(validateDataComponent('readout', at, { scale: 0 }))).toContain('A scale of 0 would show every value as the offset.');
    expect(errors(validateDataComponent('readout', at, { decimals: 9 }))).toContain('Decimals must be a whole number from 0 to 6.');
    const issue = validateDataComponent('level', at, { min: 10, max: 0 })[0];
    expect(issue.scope).toBe('settings');
  });

  it('checks setpoint steps, states and history lengths', () => {
    const at = { topic: '/t', messageType: 'std_msgs/msg/Int32', field: 'data' };
    expect(errors(validateDataComponent('setpoint', at, { min: 0, max: 1, step: 2 }))).toContain('The step must fit inside the range.');
    expect(errors(validateDataComponent('setpoint', at, { step: 0 }))).toContain('The step must be greater than 0.');
    expect(warnings(validateDataComponent('setpoint', at, { step: 0.5, fieldType: 'int32' }))[0]).toMatch(/rounded to whole numbers/);
    expect(errors(validateDataComponent('state', at, {
      stateMappings: [{ value: 'OK', label: 'OK', tone: 'ok' }, { value: 'ok', label: 'Fine', tone: 'ok' }, { value: ' ', label: '', tone: 'neutral' }],
    }))).toEqual(['Every state needs the value it matches.', 'The value “ok” is listed twice.']);
    expect(errors(validateDataComponent('text', at, { historyLength: 0 }))).toContain('Keep between 1 and 50 messages.');
  });

  it('explains a received value that cannot be shown', () => {
    expect(describeMismatch(undefined, 'percentage', ['number'])).toBe('No “percentage” in the messages');
    expect(describeMismatch({ x: 1 }, 'linear', ['number'])).toBe('“linear” holds several values');
    expect(describeMismatch('RUNNING', 'data', ['number'])).toBe('“data” is text, not a number');
    expect(describeMismatch('RUNNING', 'data', ['string', 'number', 'bool'])).toBeUndefined();
    expect(describeMismatch('12', 'data', ['number'])).toBeUndefined();
  });
});
