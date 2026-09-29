// The pad's value components (gauge, level bar, readout, state, setpoint and text) bind to ROS the same way: a
// topic, its message type and one field of it. This module says which way each one's data flows, which kinds of
// field it can use, and whether a configuration can work, so the editor, the settings and the components agree.
import type { FieldKind, MessageFieldOption } from './rosMessageUtils';
import type { GamepadComponentConfig, PadComponentType, ROSTopicConfig } from './types';
import { rangeOf } from './padValues';

export const DATA_COMPONENT_TYPES = ['gauge', 'level', 'readout', 'state', 'setpoint', 'text'] as const satisfies readonly PadComponentType[];
export type DataComponentType = (typeof DATA_COMPONENT_TYPES)[number];

export const isDataComponentType = (type: string | undefined): type is DataComponentType =>
  (DATA_COMPONENT_TYPES as readonly string[]).includes(type ?? '');

export interface DataBinding {
  /** Subscribing components show a field; publishing ones send it. */
  direction: 'subscribe' | 'publish';
  /** The kinds of field the component can show or send. */
  fieldKinds: readonly FieldKind[];
  /** Message types offered first; any other type with a suitable field works too. */
  suggestedTypes: readonly string[];
}

const SCALAR_TYPES = [
  'std_msgs/msg/Float64', 'std_msgs/msg/Float32', 'std_msgs/msg/Int32', 'std_msgs/msg/Int64',
  'std_msgs/msg/Int16', 'std_msgs/msg/UInt8', 'std_msgs/msg/UInt16', 'std_msgs/msg/UInt32',
];
const MEASUREMENT_TYPES = [
  'sensor_msgs/msg/BatteryState', 'sensor_msgs/msg/Temperature', 'sensor_msgs/msg/Range',
  'sensor_msgs/msg/FluidPressure', 'sensor_msgs/msg/RelativeHumidity', 'nav_msgs/msg/Odometry',
  'geometry_msgs/msg/Twist', 'sensor_msgs/msg/JointState',
];

export const DATA_BINDINGS: Record<DataComponentType, DataBinding> = {
  gauge: { direction: 'subscribe', fieldKinds: ['number'], suggestedTypes: [...SCALAR_TYPES, ...MEASUREMENT_TYPES] },
  level: { direction: 'subscribe', fieldKinds: ['number'], suggestedTypes: [...SCALAR_TYPES, ...MEASUREMENT_TYPES] },
  readout: { direction: 'subscribe', fieldKinds: ['number'], suggestedTypes: [...SCALAR_TYPES, ...MEASUREMENT_TYPES] },
  state: {
    direction: 'subscribe',
    fieldKinds: ['string', 'number', 'bool'],
    suggestedTypes: ['std_msgs/msg/String', 'std_msgs/msg/Bool', 'std_msgs/msg/Int32', 'std_msgs/msg/UInt8', 'sensor_msgs/msg/BatteryState'],
  },
  setpoint: { direction: 'publish', fieldKinds: ['number'], suggestedTypes: [...SCALAR_TYPES, 'geometry_msgs/msg/Twist'] },
  text: {
    direction: 'subscribe',
    fieldKinds: ['string', 'number', 'bool'],
    suggestedTypes: ['std_msgs/msg/String', 'rcl_interfaces/msg/Log', 'diagnostic_msgs/msg/KeyValue'],
  },
};

const KIND_NAMES: Record<FieldKind, string> = { number: 'a number', bool: 'a true/false value', string: 'text' };

const kindList = (kinds: readonly FieldKind[]) =>
  kinds.map(kind => KIND_NAMES[kind]).join(kinds.length > 2 ? ', ' : ' or ');

export interface ConfigIssue {
  /** An error blocks saving; a warning only informs. */
  level: 'error' | 'warning';
  /** What the issue is about: the topic, type and field, or the component's own settings. */
  scope: 'source' | 'settings';
  message: string;
}

/** A path into an array beyond the elements that were listed, e.g. `position[12]` when `position[0]` is known. */
const matchesIndexedField = (path: string, fields: readonly MessageFieldOption[]) => {
  const base = path.replace(/\[\d+\]$/, '[0]');
  return base !== path && fields.some(field => field.path === base);
};

/**
 * What stops a value component's configuration from working, or might. `fields` are the message's fields when they
 * are known (from rosapi or the built-in list); without them only the shape of the configuration is checked.
 */
export function validateDataComponent(
  type: DataComponentType,
  action: Partial<ROSTopicConfig>,
  config: GamepadComponentConfig['config'] = {},
  fields: readonly MessageFieldOption[] = []
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const binding = DATA_BINDINGS[type];
  let scope: ConfigIssue['scope'] = 'source';
  const error = (message: string) => issues.push({ level: 'error', scope, message });
  const warning = (message: string) => issues.push({ level: 'warning', scope, message });
  const path = (action.field ?? '').trim();
  const messageType = (action.messageType ?? '').trim();

  if (!action.topic?.trim()) error('Choose a topic.');
  if (!messageType) error('Enter the topic\'s message type.');
  if (!path) {
    error(binding.direction === 'publish' ? 'Choose the field to send.' : 'Choose the field to show.');
  } else if (fields.length > 0 && messageType) {
    const field = fields.find(item => item.path === path);
    if (field && !binding.fieldKinds.includes(field.kind)) {
      error(`“${path}” is ${KIND_NAMES[field.kind]}; this component needs ${kindList(binding.fieldKinds)}.`);
    } else if (!field && fields.some(item => item.path.startsWith(`${path}.`) || item.path.startsWith(`${path}[`))) {
      error(`“${path}” holds several values; choose one of them, such as “${fields.find(item => item.path.startsWith(path))?.path}”.`);
    } else if (!field && !matchesIndexedField(path, fields)) {
      warning(`${messageType} has no field “${path}” that Robo-Boy knows of. It will show a value only if the messages have one there.`);
    }
  }

  scope = 'settings';
  if (type === 'gauge' || type === 'level' || type === 'setpoint') {
    if (Number.isFinite(config.min) && Number.isFinite(config.max) && (config.min as number) >= (config.max as number)) {
      error('The minimum must be lower than the maximum.');
    }
  }
  if (config.scale === 0) error('A scale of 0 would show every value as the offset.');
  if (config.decimals !== undefined && !(Number.isInteger(config.decimals) && config.decimals >= 0 && config.decimals <= 6)) {
    error('Decimals must be a whole number from 0 to 6.');
  }

  if (type === 'gauge' || type === 'level' || type === 'readout') {
    const { warnAt, alarmAt, alertBelow } = config;
    if (Number.isFinite(warnAt) && Number.isFinite(alarmAt)) {
      const ordered = alertBelow ? (alarmAt as number) <= (warnAt as number) : (alarmAt as number) >= (warnAt as number);
      if (!ordered) {
        error(alertBelow
          ? 'Counting down, the alarm threshold must be at or below the warning one.'
          : 'The alarm threshold must be at or above the warning one.');
      }
    }
    if (type !== 'readout') {
      const range = rangeOf(config);
      const outside = [warnAt, alarmAt].filter(
        (value): value is number => Number.isFinite(value) && ((value as number) < range.min || (value as number) > range.max)
      );
      if (outside.length > 0) warning(`A threshold (${outside.join(', ')}) lies outside the ${range.min}–${range.max} range and will not be marked.`);
    }
  }

  if (type === 'setpoint') {
    const range = rangeOf(config);
    if (config.step !== undefined && !(config.step > 0)) error('The step must be greater than 0.');
    else if (config.step !== undefined && config.step > range.max - range.min) error('The step must fit inside the range.');
    const fieldType = config.fieldType ?? '';
    if (/^u?int|^byte$|^char$/.test(fieldType) && config.step !== undefined && !Number.isInteger(config.step)) {
      warning(`“${path}” is ${fieldType}: values are rounded to whole numbers when sent.`);
    }
  }

  if (type === 'state') {
    const mappings = config.stateMappings ?? [];
    if (mappings.some(mapping => !mapping.value.trim())) error('Every state needs the value it matches.');
    const values = mappings.map(mapping => mapping.value.trim().toLowerCase()).filter(Boolean);
    const repeated = values.find((value, index) => values.indexOf(value) !== index);
    if (repeated) error(`The value “${repeated}” is listed twice.`);
  }

  if (type === 'text' && config.historyLength !== undefined
    && !(Number.isInteger(config.historyLength) && config.historyLength >= 1 && config.historyLength <= 50)) {
    error('Keep between 1 and 50 messages.');
  }

  if (config.staleAfterMs !== undefined && config.staleAfterMs < 0) error('The stale time cannot be negative.');

  return issues;
}

/** Why a field value cannot be shown by a component that needs these kinds, or undefined when it can. */
export function describeMismatch(raw: unknown, path: string, kinds: readonly FieldKind[]): string | undefined {
  if (raw === undefined) return `No “${path}” in the messages`;
  if (raw === null || typeof raw === 'object') return `“${path}” holds several values`;
  if (kinds.includes('number') && !kinds.includes('string') && typeof raw === 'string' && !Number.isFinite(Number(raw))) {
    return `“${path}” is text, not a number`;
  }
  return undefined;
}
