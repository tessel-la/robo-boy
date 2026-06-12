import { describe, expect, it } from 'vitest';
import { GamepadType } from './GamepadInterface';

describe('GamepadInterface', () => {
  it('only exposes custom gamepads as panel types', () => {
    expect(Object.values(GamepadType)).toEqual(['custom']);
    expect(GamepadType.Custom).toBe('custom');
  });
});
