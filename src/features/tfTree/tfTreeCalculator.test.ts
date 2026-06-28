import { describe, expect, it } from 'vitest';

import { consumeTfMessage, createEmptyTfTreeState } from './tfTreeModel';
import { calculateTfBetweenFrames, quaternionToRotationMatrix } from './tfTreeCalculator';

const transform = (
  parent: string,
  child: string,
  translation: { x: number; y: number; z: number },
  rotation = { x: 0, y: 0, z: 0, w: 1 }
) => ({
  header: { frame_id: parent, stamp: { sec: 1, nanosec: 0 } },
  child_frame_id: child,
  transform: { translation, rotation },
});

describe('TF tree calculator', () => {
  it('composes transforms along the path from source to target', () => {
    const quarterTurn = Math.sqrt(0.5);
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [
          transform('map', 'base', { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: quarterTurn, w: quarterTurn }),
          transform('base', 'camera', { x: 1, y: 0, z: 0 }),
        ],
      },
      'dynamic',
      1_000
    );

    const result = calculateTfBetweenFrames(state, 'map', 'camera');

    expect(result?.path).toEqual(['map', 'base', 'camera']);
    expect(result?.translation.x).toBeCloseTo(1);
    expect(result?.translation.y).toBeCloseTo(1);
    expect(result?.translation.z).toBeCloseTo(0);
    expect(result?.rotation.z).toBeCloseTo(quarterTurn);
    expect(result?.rotation.w).toBeCloseTo(quarterTurn);
  });

  it('inverts a path when calculating from child to parent', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('map', 'base', { x: 2, y: -1, z: 3 })] },
      'static',
      1_000
    );

    const result = calculateTfBetweenFrames(state, '/base', '/map');

    expect(result?.translation).toMatchObject({ x: -2, y: 1, z: -3 });
    expect(result?.path).toEqual(['base', 'map']);
  });

  it('returns identity for the same frame and null for disconnected frames', () => {
    let state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('map', 'base', { x: 1, y: 0, z: 0 })] },
      'dynamic',
      1_000
    );
    state = consumeTfMessage(
      state,
      { transforms: [transform('world', 'camera', { x: 0, y: 1, z: 0 })] },
      'static',
      1_000
    );

    expect(calculateTfBetweenFrames(state, 'map', 'map')).toMatchObject({
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    expect(calculateTfBetweenFrames(state, 'map', 'camera')).toBeNull();
  });

  it('builds a row-major rotation matrix', () => {
    const quarterTurn = Math.sqrt(0.5);
    const matrix = quaternionToRotationMatrix({ x: 0, y: 0, z: quarterTurn, w: quarterTurn });

    expect(matrix[0][0]).toBeCloseTo(0);
    expect(matrix[0][1]).toBeCloseTo(-1);
    expect(matrix[1][0]).toBeCloseTo(1);
    expect(matrix[1][1]).toBeCloseTo(0);
    expect(matrix[2][2]).toBeCloseTo(1);
  });
});
