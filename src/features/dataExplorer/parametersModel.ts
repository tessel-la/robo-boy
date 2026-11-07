/** ROS 2 rcl_interfaces/ParameterType values. Keep int64 values inside JS's exact range. */
export const PARAMETER_TYPES = [
  'not set',
  'bool',
  'integer',
  'double',
  'string',
  'byte[]',
  'bool[]',
  'integer[]',
  'double[]',
  'string[]',
] as const;
export type ParameterValue = boolean | number | string | boolean[] | number[] | string[] | null;
export const isParameterNodeName = (node: unknown): node is string =>
  typeof node === 'string' && node.length < 450 && /^\/(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*$/.test(node);
export interface ParameterDescriptor {
  name: string;
  type: number;
  description: string;
  additional_constraints: string;
  read_only: boolean;
  dynamic_typing: boolean;
  integer_range: { from_value: number; to_value: number; step: number }[];
  floating_point_range: { from_value: number; to_value: number; step: number }[];
}
export interface NodeParameter {
  name: string;
  type: number;
  value: ParameterValue;
  descriptor: ParameterDescriptor;
  error?: string;
}
export interface ParameterDraft {
  original: NodeParameter;
  value: ParameterValue;
}
export const sameParameterValue = (a: ParameterValue, b: ParameterValue) => JSON.stringify(a) === JSON.stringify(b);
export const formatParameterValue = (value: ParameterValue) =>
  typeof value === 'string' ? value : JSON.stringify(value);
const fields = [
  '',
  'bool_value',
  'integer_value',
  'double_value',
  'string_value',
  'byte_array_value',
  'bool_array_value',
  'integer_array_value',
  'double_array_value',
  'string_array_value',
];

function validateType(type: number, value: unknown): asserts value is ParameterValue {
  const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
  const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const valid =
    type === 0
      ? value === null
      : type === 1
        ? typeof value === 'boolean'
        : type === 2
          ? integer(value)
          : type === 3
            ? numeric(value)
            : type === 4
              ? typeof value === 'string'
              : Array.isArray(value) &&
                value.length <= 4096 &&
                value.every(v =>
                  type === 5
                    ? integer(v) && v >= 0 && v <= 255
                    : type === 6
                      ? typeof v === 'boolean'
                      : type === 7
                        ? integer(v)
                        : type === 8
                          ? numeric(v)
                          : type === 9 && typeof v === 'string'
                );
  if (!valid || !Number.isInteger(type) || type < 0 || type > 9)
    throw new Error(
      type === 2 || type === 7
        ? 'Expected exact integers within the JavaScript safe integer range.'
        : `Expected ${PARAMETER_TYPES[type] ?? 'a supported parameter type'} (arrays: at most 4096 items).`
    );
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 65536)
    throw new Error('Parameter values are limited to 64 KiB.');
}

export function decodeParameter(
  name: string,
  wire: Record<string, unknown>,
  descriptor: ParameterDescriptor
): NodeParameter {
  const type = wire?.type as number;
  let value = type === 0 ? null : wire?.[fields[type]];
  try {
    if (type === 5 && typeof value === 'string') value = Array.from(atob(value), char => char.charCodeAt(0));
    validateType(type, value);
    if (
      !descriptor ||
      descriptor.name !== name ||
      !Number.isInteger(descriptor.type) ||
      typeof descriptor.read_only !== 'boolean' ||
      typeof descriptor.dynamic_typing !== 'boolean' ||
      typeof descriptor.description !== 'string' ||
      typeof descriptor.additional_constraints !== 'string' ||
      !Array.isArray(descriptor.integer_range) ||
      !Array.isArray(descriptor.floating_point_range) ||
      [...descriptor.integer_range, ...descriptor.floating_point_range].some(
        range =>
          !range ||
          ![range.from_value, range.to_value, range.step].every(
            value => typeof value === 'number' && Number.isFinite(value)
          )
      ) ||
      (!descriptor.dynamic_typing && type !== 0 && descriptor.type !== type)
    )
      throw new Error('The node returned an invalid parameter descriptor.');
    return { name, type, value, descriptor };
  } catch (error) {
    return {
      name,
      type,
      value: null,
      descriptor: {
        name,
        type,
        description: '',
        additional_constraints: '',
        read_only: true,
        dynamic_typing: false,
        integer_range: [],
        floating_point_range: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Syntax and declared numeric constraints are checked again immediately before a write. */
export function validateParameterValue(parameter: NodeParameter, value: unknown): asserts value is ParameterValue {
  if (parameter.error) throw new Error(parameter.error);
  if (parameter.descriptor.read_only) throw new Error('This parameter is read-only.');
  if (parameter.type === 0) throw new Error('Unset parameters cannot be edited here.');
  validateType(parameter.type, value);
  const ranges =
    parameter.type === 2
      ? parameter.descriptor.integer_range
      : parameter.type === 3
        ? parameter.descriptor.floating_point_range
        : [];
  for (const range of ranges) {
    const { from_value: from, to_value: to, step } = range;
    if (
      ![from, to, step].every(Number.isFinite) ||
      from > to ||
      step < 0 ||
      (parameter.type === 2 && ![from, to, step].every(Number.isSafeInteger))
    )
      throw new Error('The node declared a range that cannot be represented exactly.');
    const number = value as number;
    if (number < from || number > to) throw new Error(`Value must be between ${from} and ${to}.`);
    // rcl_interfaces allows either endpoint, even if the upper endpoint is off the step grid.
    const steps = (number - from) / step;
    const offStep =
      parameter.type === 2 && step > 0
        ? (BigInt(number) - BigInt(from)) % BigInt(step) !== 0n
        : Math.abs(steps - Math.round(steps)) > 1e-6;
    if (step > 0 && number !== to && offStep) throw new Error(`Value must follow step ${step} from ${from}.`);
  }
}

export function parseParameterInput(parameter: NodeParameter, text: string): ParameterValue {
  if (text.length > 65536) throw new Error('Parameter values are limited to 64 KiB.');
  if (parameter.type === 2 && !/^\s*-?\d+\s*$/.test(text)) throw new Error('Enter a whole integer.');
  if ((parameter.type === 5 || parameter.type === 7) && !/^\s*\[\s*(?:-?\d+\s*(?:,\s*-?\d+\s*)*)?\]\s*$/.test(text))
    throw new Error('Enter a JSON array of whole integers.');
  let value: unknown;
  try {
    value = parameter.type === 4 ? text : JSON.parse(text);
  } catch {
    throw new Error(
      parameter.type >= 5 ? 'Enter a JSON array, for example [1, 2].' : 'Enter a valid number or boolean.'
    );
  }
  validateParameterValue(parameter, value);
  return value;
}

export function encodeParameter(parameter: NodeParameter, value: ParameterValue) {
  validateParameterValue(parameter, value);
  return { name: parameter.name, value: { type: parameter.type, [fields[parameter.type]]: value } };
}

export function draftConflict(draft: ParameterDraft, current?: NodeParameter): string | undefined {
  if (!current || current.type !== draft.original.type || !sameParameterValue(current.value, draft.original.value))
    return 'The live value changed. Discard this edit and stage it again.';
  try {
    validateParameterValue(current, draft.value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
