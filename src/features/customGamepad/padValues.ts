// What the pad's data components do with a value: read it from a message, scale and format it, place it on a
// range, say whether it has crossed a threshold, name the state it stands for, and build the message a setpoint
// publishes. Pure functions, shared by every component that shows or sends a value.
import type { GamepadComponentConfig } from './types';
import { getValueAtPath } from './rosMessageUtils';

type ValueConfig = NonNullable<GamepadComponentConfig['config']>;

export type ValueLevel = 'normal' | 'warning' | 'alarm';
export type StateTone = 'ok' | 'info' | 'warning' | 'error' | 'neutral';

export interface StateMapping {
  value: string;
  label: string;
  tone: StateTone;
}

export const STATE_TONES: StateTone[] = ['ok', 'info', 'warning', 'error', 'neutral'];

/** A number from a message field: numbers as they are, booleans as 1/0, numeric strings parsed. */
export function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'bigint') return Number(raw);
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The value shown for a raw field value: `raw × scale + offset`, or null when it is not a number. */
export function toDisplayNumber(raw: unknown, config: ValueConfig = {}): number | null {
  const value = toNumber(raw);
  if (value === null) return null;
  return value * (config.scale ?? 1) + (config.offset ?? 0);
}

/** The field a data component reads or writes: its own path, else the action's field, else `data`. */
export const valuePathOf = (component: Pick<GamepadComponentConfig, 'action'>): string =>
  ((component.action as { field?: string } | undefined)?.field || 'data').trim();

export const readValue = (message: unknown, path: string): unknown => getValueAtPath(message, path);

/** The range a value is drawn on, never empty and never reversed. */
export function rangeOf(config: ValueConfig = {}, fallback = { min: 0, max: 100 }): { min: number; max: number } {
  const min = Number.isFinite(config.min) ? (config.min as number) : fallback.min;
  const max = Number.isFinite(config.max) ? (config.max as number) : fallback.max;
  if (max > min) return { min, max };
  return max < min ? { min: max, max: min } : { min, max: min + 1 };
}

/** Where a value sits on its range, 0–1, clamped. */
export function fractionOf(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(1, (value - range.min) / span));
}

/** Enough decimals to tell values on this range apart: none for wide ranges, more for narrow ones. */
export function defaultDecimals(range: { min: number; max: number }): number {
  const span = Math.abs(range.max - range.min);
  if (span >= 100) return 0;
  if (span >= 10) return 1;
  if (span >= 1) return 2;
  return 3;
}

/** Enough decimals for a value shown on its own: fewer as it grows. */
export function decimalsForValue(value: number): number {
  const size = Math.abs(value);
  if (size >= 1000) return 0;
  if (size >= 100) return 1;
  if (size >= 1 || size === 0) return 2;
  return 3;
}

/**
 * A value as displayed: with the configured decimals, or else as many as its range needs (or, with no range, as
 * many as its own size needs).
 */
export function formatValue(value: number | null, config: ValueConfig = {}, range?: { min: number; max: number }): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const decimals = Number.isInteger(config.decimals) && (config.decimals as number) >= 0
    ? Math.min(6, config.decimals as number)
    : range ? defaultDecimals(range) : decimalsForValue(value);
  const text = value.toFixed(decimals);
  // -0.00 reads as a sign that means nothing.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/**
 * Whether a value has crossed its thresholds. By default high values are the concern (temperature, current);
 * with `alertBelow` low ones are (battery, pressure).
 */
export function levelOf(value: number | null, config: ValueConfig = {}): ValueLevel {
  if (value === null) return 'normal';
  const below = Boolean(config.alertBelow);
  const crossed = (threshold: number | undefined) =>
    threshold !== undefined && Number.isFinite(threshold) && (below ? value <= threshold : value >= threshold);
  if (crossed(config.alarmAt)) return 'alarm';
  if (crossed(config.warnAt)) return 'warning';
  return 'normal';
}

const normalizeStateValue = (value: string): string => value.trim().toLowerCase();

/** The mapping a raw value matches: by text (case-insensitive), by number (1 = 1.0), or by truth (true = 1). */
export function matchState(raw: unknown, mappings: readonly StateMapping[] = []): StateMapping | undefined {
  if (raw === undefined || raw === null) return undefined;
  const text = normalizeStateValue(String(raw));
  const number = toNumber(raw);
  return mappings.find(mapping => {
    const expected = normalizeStateValue(mapping.value);
    if (expected === text) return true;
    const expectedNumber = toNumber(expected === 'true' ? 1 : expected === 'false' ? 0 : expected);
    return number !== null && expectedNumber !== null && expected !== '' && number === expectedNumber;
  });
}

/** How a raw value reads when it has no mapping: booleans and numbers as they are, text trimmed. */
export function describeRawValue(raw: unknown): string {
  if (raw === undefined || raw === null) return '—';
  if (typeof raw === 'object') return Array.isArray(raw) ? `[${raw.length} values]` : '{…}';
  return String(raw).trim() || '(empty)';
}

/** Whether a field value can be shown as one value (not an object or an array). */
export const isScalar = (raw: unknown) =>
  raw !== undefined && raw !== null && (typeof raw !== 'object');

const INTEGER_TYPES = /^(u?int(8|16|32|64)|byte|char)$/;
const UNSIGNED_TYPES = /^(uint(8|16|32|64)|byte|char)$/;

/** The primitive type of a std_msgs scalar message (`std_msgs/msg/Int32` → `int32`), when it is one. */
export function stdScalarType(messageType: string): string | undefined {
  const match = /^std_msgs\/(?:msg\/)?(Float32|Float64|Int8|Int16|Int32|Int64|UInt8|UInt16|UInt32|UInt64|Byte|Char|Bool)$/.exec(messageType.trim());
  return match ? match[1].toLowerCase() : undefined;
}

/** A value made fit for a field of this primitive type: rounded for integers, not negative for unsigned ones. */
export function coerceForType(value: number, rosType?: string): number | boolean {
  const type = (rosType || '').replace(/\[\]$/, '');
  if (type === 'bool') return value !== 0;
  if (INTEGER_TYPES.test(type)) {
    const rounded = Math.round(value);
    return UNSIGNED_TYPES.test(type) ? Math.max(0, rounded) : rounded;
  }
  return value;
}

/**
 * The message a setpoint publishes: the value at its field path, nested as the path says (`linear.x` →
 * `{linear: {x}}`), typed for the field. Fields the path does not name are left to their defaults.
 */
export function buildFieldMessage(messageType: string, fieldPath: string, value: number, fieldType?: string): Record<string, unknown> {
  const type = fieldType || stdScalarType(messageType) || 'float64';
  const typed = coerceForType(value, type);
  const segments = (fieldPath || 'data').split('.').filter(Boolean);
  const message: Record<string, unknown> = {};
  let cursor = message;
  segments.forEach((segment, index) => {
    const indexed = /^([^[\]]+)\[(\d+)\]$/.exec(segment);
    const last = index === segments.length - 1;
    if (indexed) {
      const array: unknown[] = Array.from({ length: Number(indexed[2]) + 1 }, () => (last ? coerceForType(0, type) : {}));
      if (last) array[Number(indexed[2])] = typed;
      cursor[indexed[1]] = array;
      if (!last) cursor = array[Number(indexed[2])] as Record<string, unknown>;
      return;
    }
    if (last) {
      cursor[segment] = typed;
    } else {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
    }
  });
  return message;
}

/** A setpoint value kept inside its range and on its step. */
export function clampToStep(value: number, range: { min: number; max: number }, step?: number): number {
  const clamped = Math.max(range.min, Math.min(range.max, value));
  if (!step || !(step > 0)) return clamped;
  const stepped = range.min + Math.round((clamped - range.min) / step) * step;
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  return Math.max(range.min, Math.min(range.max, Number(stepped.toFixed(decimals))));
}
