import { describe, expect, it } from 'vitest';
import type { CustomGamepadLayout } from '../../../features/customGamepad/types';
import {
  defaultControlPose,
  normalizePadPoses,
  padDimensions,
  padGridDestination,
  snapPadPose,
} from './padSpatialLayout';

const layout = {
  gridSize: { width: 4, height: 4 },
  components: [
    { id: 'a', position: { x: 0, y: 0, width: 1, height: 1 } },
    { id: 'b', position: { x: 1, y: 0, width: 2, height: 2 } },
  ],
} as CustomGamepadLayout;
const [a, b] = layout.components;

describe('XR Pad grid placement', () => {
  it('rounds to cells, clamps to the board and resets depth and rotation', () => {
    const original = JSON.stringify(layout);
    const desired = defaultControlPose(layout, { x: 2, y: 3, width: 1, height: 1 });
    desired.position[0] += padDimensions(layout).cell * 0.3;
    desired.position[2] = 1;
    desired.quaternion = [0, 1, 0, 0];
    expect(snapPadPose(layout, a, desired, {})).toEqual(
      defaultControlPose(layout, { x: 2, y: 3, width: 1, height: 1 })
    );
    desired.position = [100, -100, 1];
    expect(padGridDestination(layout, a, desired).rect).toEqual({ x: 3, y: 3, width: 1, height: 1 });
    expect(JSON.stringify(layout)).toBe(original);
  });

  it('rejects occupied drops and reserves the whole scaled footprint', () => {
    const occupied = defaultControlPose(layout, b.position);
    expect(snapPadPose(layout, a, occupied, {})).toBeNull();
    const desired = { ...defaultControlPose(layout, { x: 0, y: 2, width: 2, height: 2 }), scale: 1.3 };
    expect(padGridDestination(layout, a, desired).rect).toEqual({ x: 0, y: 2, width: 2, height: 2 });
    expect(snapPadPose(layout, a, desired, {})?.scale).toBe(1.3);
    desired.position[1] += padDimensions(layout).cell;
    expect(snapPadPose(layout, a, desired, {})).toBeNull();
    expect(padGridDestination(layout, b, { ...occupied, scale: 10 }).pose.scale).toBe(2);
  });

  it('normalizes old free poses and restores defaults for conflicting stored placements', () => {
    const free = defaultControlPose(layout, { x: 2, y: 3, width: 1, height: 1 });
    free.position[2] = 0.5;
    expect(normalizePadPoses(layout, { a: free }).a.position[2]).toBe(0.025);
    const poses = normalizePadPoses(layout, {
      a: defaultControlPose(layout, b.position),
      b: defaultControlPose(layout, b.position),
    });
    expect(poses.a).toEqual(defaultControlPose(layout, a.position));
    expect(poses.b).toEqual(defaultControlPose(layout, b.position));
    // A restored default can block another previously valid candidate.
    const chain = normalizePadPoses(layout, {
      a: defaultControlPose(layout, b.position),
      b: defaultControlPose(layout, { x: 0, y: 0, width: 2, height: 2 }),
    });
    for (const c of layout.components) expect(snapPadPose(layout, c, chain[c.id], chain)).toEqual(chain[c.id]);
  });
});
