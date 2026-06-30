import {
  BlackboardComparisonOperator,
  BlackboardInputBinding,
  BlackboardOutputBinding,
} from './types';

export type Blackboard = Map<string, unknown>;

export const cloneJsonValue = <T,>(value: T): T => {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export const createBlackboard = (defaults?: Record<string, unknown>): Blackboard => (
  new Map(Object.entries(defaults || {}).map(([key, value]) => [key, cloneJsonValue(value)]))
);

export const getValueAtPath = (value: unknown, path: string): unknown => {
  if (!path.trim()) return value;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    const key: string | number = /^\d+$/.test(segment) ? Number(segment) : segment;
    return (current as Record<string | number, unknown>)[key];
  }, value);
};

export const setValueAtPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current: Record<string, unknown> = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      current[part] = cloneJsonValue(value);
      return;
    }
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  });
};

export const applyInputBindings = (
  payload: Record<string, unknown>,
  bindings: BlackboardInputBinding[] | undefined,
  blackboard: Blackboard
): Record<string, unknown> => {
  const result = cloneJsonValue(payload);
  bindings?.forEach(binding => {
    if (binding.variable && binding.targetPath && blackboard.has(binding.variable)) {
      setValueAtPath(result, binding.targetPath, blackboard.get(binding.variable));
    }
  });
  return result;
};

export const applyOutputBindings = (
  source: unknown,
  bindings: BlackboardOutputBinding[] | undefined,
  blackboard: Blackboard
): string[] => {
  const changed: string[] = [];
  bindings?.forEach(binding => {
    if (!binding.variable) return;
    const value = getValueAtPath(source, binding.sourcePath);
    if (value === undefined) return;
    blackboard.set(binding.variable, cloneJsonValue(value));
    changed.push(binding.variable);
  });
  return changed;
};

export const evaluateBlackboardValue = (
  value: unknown,
  operator: BlackboardComparisonOperator,
  expectedValue?: unknown,
  exists = true
): boolean => {
  if (operator === 'exists') return exists;
  if (!exists) return false;
  if (operator === 'truthy') return Boolean(value);
  if (operator === 'falsy') return !value;
  if (operator === 'equals') return JSON.stringify(value) === JSON.stringify(expectedValue);
  if (operator === 'notEquals') return JSON.stringify(value) !== JSON.stringify(expectedValue);
  if (typeof value !== 'number' || typeof expectedValue !== 'number') return false;
  if (operator === 'greaterThan') return value > expectedValue;
  if (operator === 'greaterThanOrEqual') return value >= expectedValue;
  if (operator === 'lessThan') return value < expectedValue;
  if (operator === 'lessThanOrEqual') return value <= expectedValue;
  return false;
};
