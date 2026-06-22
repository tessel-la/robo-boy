import { describe, expect, it } from 'vitest';

import {
  computeConnectedComponents,
  consumeTfMessage,
  createEmptyTfTreeState,
  getTfGraphDiagnostics,
  isTransformStale,
  stampToMilliseconds,
} from './tfTreeModel';

const transform = (parent: unknown, child: unknown, sec = 10, nanosec = 0) => ({
  header: { frame_id: parent, stamp: { sec, nanosec } },
  child_frame_id: child,
  transform: {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
});

describe('tfTreeModel', () => {
  it('parses ROS1 and ROS2 stamps', () => {
    expect(stampToMilliseconds({ sec: 12, nanosec: 500_000_000 })).toBe(12_500);
    expect(stampToMilliseconds({ secs: 2, nsecs: 250_000_000 })).toBe(2_250);
    expect(stampToMilliseconds({ sec: 0, nanosec: 0 })).toBeNull();
  });

  it('normalizes frame names and stores one latest edge per child', () => {
    let state = createEmptyTfTreeState();
    state = consumeTfMessage(
      state,
      { transforms: [transform('/map', 'base_link'), transform('map', 'base_link')] },
      'dynamic',
      20_000
    );

    expect(state.transformsByChild.size).toBe(1);
    expect(state.transformsByChild.get('base_link')).toMatchObject({
      parentFrame: 'map',
      childFrame: 'base_link',
      source: 'dynamic',
      messageTimestampMs: 10_000,
    });
  });

  it('ignores malformed transforms without discarding valid transforms', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [null, {}, transform('', 'child'), transform('parent', null), transform('world', 'camera')],
      },
      'dynamic',
      20_000
    );

    expect([...state.transformsByChild.keys()]).toEqual(['camera']);
  });

  it('keeps the newest stamped transform and refreshes equal timestamp repeats', () => {
    let state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('new-parent', 'child', 20)] },
      'dynamic',
      30_000
    );
    state = consumeTfMessage(state, { transforms: [transform('old-parent', 'child', 19)] }, 'dynamic', 31_000);
    expect(state.transformsByChild.get('child')?.parentFrame).toBe('new-parent');
    expect(state.transformsByChild.get('child')?.receivedAtMs).toBe(30_000);

    state = consumeTfMessage(state, { transforms: [transform('new-parent', 'child', 20)] }, 'dynamic', 32_000);
    expect(state.transformsByChild.get('child')?.receivedAtMs).toBe(32_000);
  });

  it('uses receive order when only one transform has a usable stamp', () => {
    let state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('static-parent', 'child', 0)] },
      'static',
      100_000
    );
    state = consumeTfMessage(state, { transforms: [transform('dynamic-parent', 'child', 20)] }, 'dynamic', 101_000);

    expect(state.transformsByChild.get('child')?.parentFrame).toBe('dynamic-parent');
  });

  it('finds every disconnected component', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [transform('map', 'base'), transform('base', 'laser'), transform('world', 'camera')],
      },
      'dynamic',
      20_000
    );

    expect(computeConnectedComponents(state)).toEqual([
      ['base', 'laser', 'map'],
      ['camera', 'world'],
    ]);
  });

  it('surfaces observed multiple parents while retaining the latest parent', () => {
    let state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('map', 'base', 10)] },
      'dynamic',
      20_000
    );
    state = consumeTfMessage(state, { transforms: [transform('odom', 'base', 11)] }, 'dynamic', 21_000);

    expect(state.transformsByChild.get('base')?.parentFrame).toBe('odom');
    expect(getTfGraphDiagnostics(state).multipleParents).toEqual([
      { childFrame: 'base', parentFrames: ['map', 'odom'] },
    ]);
  });

  it('detects cycles without reporting the same cycle repeatedly', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      {
        transforms: [transform('a', 'b'), transform('b', 'c'), transform('c', 'a')],
      },
      'dynamic',
      20_000
    );

    const cycles = getTfGraphDiagnostics(state).cycles;
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(['a', 'b', 'c']));
  });

  it('never marks static transforms stale', () => {
    const state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('base', 'sensor')] },
      'static',
      1_000
    );
    const record = state.transformsByChild.get('sensor')!;

    expect(isTransformStale(record, 1_000_000, 5_000)).toBe(false);
  });
});
