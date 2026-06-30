import { describe, expect, it } from 'vitest';
import {
  applyInputBindings,
  applyOutputBindings,
  createBlackboard,
  evaluateBlackboardValue,
  getValueAtPath,
} from './blackboard';

describe('behavior tree blackboard', () => {
  it('applies structured input and output bindings without mutating static payloads', () => {
    const blackboard = createBlackboard({ speed: 2.5 });
    const payload = { command: { speed: 0 } };
    const bound = applyInputBindings(payload, [{ variable: 'speed', targetPath: 'command.speed' }], blackboard);

    expect(bound).toEqual({ command: { speed: 2.5 } });
    expect(payload).toEqual({ command: { speed: 0 } });

    const changed = applyOutputBindings(
      { pose: { x: 4 }, flags: [false, true] },
      [
        { sourcePath: 'pose.x', variable: 'x' },
        { sourcePath: 'flags.1', variable: 'ready' },
        { sourcePath: 'missing', variable: 'ignored' },
      ],
      blackboard
    );
    expect(changed).toEqual(['x', 'ready']);
    expect(Object.fromEntries(blackboard)).toMatchObject({ x: 4, ready: true });
    expect(getValueAtPath({ items: [{ value: 3 }] }, 'items.0.value')).toBe(3);
  });

  it('evaluates typed comparisons and routes missing variables safely', () => {
    expect(evaluateBlackboardValue(true, 'truthy')).toBe(true);
    expect(evaluateBlackboardValue(false, 'falsy')).toBe(true);
    expect(evaluateBlackboardValue(5, 'greaterThan', 2)).toBe(true);
    expect(evaluateBlackboardValue('5', 'greaterThan', 2)).toBe(false);
    expect(evaluateBlackboardValue(undefined, 'exists', undefined, false)).toBe(false);
    expect(evaluateBlackboardValue({ ok: true }, 'equals', { ok: true })).toBe(true);
  });
});
