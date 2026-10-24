import { describe, expect, it } from 'vitest';
import {
  decodeParameter,
  draftConflict,
  encodeParameter,
  parseParameterInput,
  type NodeParameter,
  type ParameterDescriptor,
} from './parametersModel';

const descriptor = (type: number): ParameterDescriptor => ({
  name: 'value',
  type,
  read_only: false,
  dynamic_typing: false,
  description: 'Example',
  additional_constraints: '',
  integer_range: [],
  floating_point_range: [],
});
const parameter = (type: number, field: string, value: unknown): NodeParameter =>
  decodeParameter('value', { type, [field]: value }, descriptor(type));

describe('ROS 2 parameter values', () => {
  it.each([
    [1, 'bool_value', false, 'true', true],
    [2, 'integer_value', 1, '-2', -2],
    [3, 'double_value', 1.5, '2.75', 2.75],
    [4, 'string_value', 'a', 'a quoted "string"', 'a quoted "string"'],
    [5, 'byte_array_value', 'AP8=', '[1, 255]', [1, 255]],
    [6, 'bool_array_value', [false], '[true, false]', [true, false]],
    [7, 'integer_array_value', [1], '[-2, 3]', [-2, 3]],
    [8, 'double_array_value', [1.5], '[2.75]', [2.75]],
    [9, 'string_array_value', ['a'], '["b", "c"]', ['b', 'c']],
  ])('decodes, edits and encodes type %s', (type, field, value, text, expected) => {
    const item = parameter(type as number, field as string, value);
    expect(item.error).toBeUndefined();
    const parsed = parseParameterInput(item, text as string);
    expect(parsed).toEqual(expected);
    expect(encodeParameter(item, parsed)).toEqual({ name: 'value', value: { type, [field as string]: expected } });
  });

  it('enforces read-only, range, step and finite values', () => {
    const item = parameter(2, 'integer_value', 2);
    item.descriptor.integer_range = [{ from_value: 0, to_value: 9, step: 2 }];
    expect(parseParameterInput(item, '9')).toBe(9); // Upper endpoint is allowed by ROS.
    expect(() => parseParameterInput(item, '3')).toThrow('step');
    expect(() => parseParameterInput(item, '10')).toThrow('between');
    item.descriptor.read_only = true;
    expect(() => parseParameterInput(item, '4')).toThrow('read-only');
    expect(() => parseParameterInput(parameter(3, 'double_value', 1), '1e999')).toThrow('double');
  });

  it('does not round unsafe integers or decimal integer inputs into valid edits', () => {
    expect(parameter(2, 'integer_value', 9007199254740992).error).toContain('exact integers');
    const item = parameter(2, 'integer_value', 1);
    expect(() => parseParameterInput(item, '9007199254740993')).toThrow('exact integers');
    expect(() => parseParameterInput(item, '1.00000000000000001')).toThrow('whole integer');
    expect(() => parseParameterInput(parameter(7, 'integer_array_value', []), '[1.00000000000000001]')).toThrow(
      'whole integers'
    );
    item.descriptor.integer_range = [{ from_value: -9007199254740991, to_value: 9007199254740991, step: 2 }];
    expect(() => parseParameterInput(item, '0')).toThrow('step');
  });

  it('rejects malformed responses and bounds editable values', () => {
    expect(() => parseParameterInput(parameter(4, 'string_value', ''), '€'.repeat(30000))).toThrow('64 KiB');
    expect(decodeParameter('value', { type: 1, bool_value: true }, {} as ParameterDescriptor).error).toContain(
      'descriptor'
    );
    expect(parameter(5, 'byte_array_value', [256]).error).toBeDefined();
    expect(() => parseParameterInput(parameter(4, 'string_value', ''), 'a'.repeat(65537))).toThrow('64 KiB');
    expect(() =>
      parseParameterInput(parameter(6, 'bool_array_value', []), JSON.stringify(Array(4097).fill(false)))
    ).toThrow('4096');
    expect(() => parseParameterInput(decodeParameter('value', { type: 0 }, descriptor(0)), 'null')).toThrow('Unset');
  });

  it('detects changed values, deleted parameters, type changes and new constraints', () => {
    const original = parameter(2, 'integer_value', 1);
    const draft = { original, value: 2 };
    expect(draftConflict(draft, original)).toBeUndefined();
    expect(draftConflict(draft)).toContain('changed');
    expect(draftConflict(draft, parameter(2, 'integer_value', 3))).toContain('changed');
    expect(draftConflict(draft, parameter(3, 'double_value', 1))).toContain('changed');
    const current = parameter(2, 'integer_value', 1);
    current.descriptor.read_only = true;
    expect(draftConflict(draft, current)).toContain('read-only');
  });
});
