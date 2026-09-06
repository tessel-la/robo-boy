import { describe, expect, it } from 'vitest';
import {
  applyGamepadDeadzone,
  detectPhysicalGamepadProfile,
  findPhysicalGamepad,
  getPhysicalGamepadControlLabel,
  snapshotPhysicalGamepad,
} from './physicalGamepad';

const makeGamepad = (overrides: Partial<Gamepad> = {}): Gamepad =>
  ({
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    connected: true,
    hapticActuators: [],
    id: 'Xbox Wireless Controller',
    index: 0,
    mapping: 'standard',
    timestamp: 1,
    vibrationActuator: null,
    ...overrides,
  }) as Gamepad;

describe('physical gamepad normalization', () => {
  it('detects the supported controller families while honoring an explicit profile', () => {
    expect(detectPhysicalGamepadProfile('auto', 'Sony DualSense Wireless Controller')).toBe('playstation');
    expect(detectPhysicalGamepadProfile('auto', 'Logitech Gamepad F710')).toBe('logitech');
    expect(detectPhysicalGamepadProfile('auto', 'Microsoft X-Box One pad')).toBe('xbox');
    expect(detectPhysicalGamepadProfile('playstation', 'Logitech F310')).toBe('playstation');
    expect(getPhysicalGamepadControlLabel('face-bottom', 'playstation')).toBe('×');
  });

  it('applies and rescales a configurable deadzone', () => {
    expect(applyGamepadDeadzone(0.07, 0.08)).toBe(0);
    expect(applyGamepadDeadzone(-0.54, 0.08)).toBeCloseTo(-0.5);
    expect(applyGamepadDeadzone(2, 0.08)).toBe(1);
  });

  it('normalizes the standard four axes and seventeen buttons', () => {
    const buttons = Array.from({ length: 17 }, (_, index) => ({
      pressed: index === 4,
      touched: index === 4,
      value: index === 4 ? 1 : 0,
    }));
    const snapshot = snapshotPhysicalGamepad(makeGamepad({ axes: [0.54, -0.54, 0.07, 1], buttons }), 0.08);

    expect(snapshot.axes).toEqual([0.5, -0.5, 0, 1]);
    expect(snapshot.pressed[4]).toBe(true);
    expect(snapshot.buttons).toHaveLength(17);
  });

  it('selects a preferred connected controller or the first connected controller', () => {
    const first = makeGamepad({ index: 0 });
    const second = makeGamepad({ id: 'Second', index: 2 });
    const pads = [first, null, second];
    expect(findPhysicalGamepad(pads)).toBe(first);
    expect(findPhysicalGamepad(pads, 2)).toBe(second);
    expect(findPhysicalGamepad(pads, 1)).toBeNull();
  });
});
