import { beforeEach, describe, expect, it } from 'vitest';
import {
  XR_WORKSPACE_STORAGE_KEY,
  createDefaultXrWorkspaceState,
  loadXrWorkspaceState,
  normalizeXrPose,
  normalizeXrWorkspaceState,
  pruneXrWorkspaceState,
  saveXrWorkspaceState,
  withPanelPlacement,
} from './xrWorkspaceStorage';
import type { XrPose } from './types';

const pose = (overrides: Partial<XrPose> = {}): XrPose => ({
  position: [1, 2, 3],
  quaternion: [0, 0, 0, 1],
  scale: 1,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('pose normalization', () => {
  it('accepts a complete pose', () => {
    expect(normalizeXrPose(pose())).toEqual(pose());
  });

  it('rejects a partially valid pose rather than half-applying it', () => {
    // A pose with a good position and a broken rotation would place a panel somewhere plausible but
    // wrong, which in a headset means hunting for a panel that is behind you or inside the floor.
    expect(normalizeXrPose({ ...pose(), quaternion: [0, 0, 1] })).toBeNull();
    expect(normalizeXrPose({ ...pose(), position: [1, 2] })).toBeNull();
    expect(normalizeXrPose({ ...pose(), position: [1, Number.NaN, 3] })).toBeNull();
    expect(normalizeXrPose({ ...pose(), quaternion: [0, 0, 0, 0] })).toBeNull();
    expect(normalizeXrPose(null)).toBeNull();
    expect(normalizeXrPose('nonsense')).toBeNull();
  });

  it('clamps scale instead of discarding the placement', () => {
    // Scale is recoverable in a way rotation is not: the panel is still where it should be.
    expect(normalizeXrPose({ ...pose(), scale: 1e9 })?.scale).toBe(20);
    expect(normalizeXrPose({ ...pose(), scale: 0 })?.scale).toBe(0.05);
    expect(normalizeXrPose({ ...pose(), scale: Number.NaN })?.scale).toBe(1);
  });
});

describe('workspace state normalization', () => {
  it('starts empty for anything that is not a version 1 document', () => {
    expect(normalizeXrWorkspaceState(undefined)).toEqual(createDefaultXrWorkspaceState());
    expect(normalizeXrWorkspaceState({ version: 99, panels: {} })).toEqual(
      createDefaultXrWorkspaceState()
    );
    expect(normalizeXrWorkspaceState('{}')).toEqual(createDefaultXrWorkspaceState());
  });

  it('keeps the good placements and drops only the broken ones', () => {
    const state = normalizeXrWorkspaceState({
      version: 1,
      panels: {
        good: { pose: pose(), pinned: true, attach: 'viewer' },
        broken: { pose: { position: [0, 0] } },
        alsoBroken: 7,
      },
    });

    // One malformed entry must not cost the user their whole room.
    expect(Object.keys(state.panels)).toEqual(['good']);
    expect(state.panels.good).toEqual({ pose: pose(), pinned: true, attach: 'viewer' });
  });

  it('defaults an unrecognised attach mode to world rather than failing', () => {
    const state = normalizeXrWorkspaceState({
      version: 1,
      panels: { a: { pose: pose(), attach: 'orbit' } },
    });
    expect(state.panels.a.attach).toBe('world');
    expect(state.panels.a.pinned).toBe(false);
  });

  it('carries world and desk poses only when they parse', () => {
    const state = normalizeXrWorkspaceState({
      version: 1,
      panels: {},
      world: pose({ position: [0, 0, -2] }),
      desk: { position: 'no' },
    });
    expect(state.world).toEqual(pose({ position: [0, 0, -2] }));
    expect(state.desk).toBeUndefined();
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const state = withPanelPlacement(createDefaultXrWorkspaceState(), 'panel-1', {
      pose: pose(),
      pinned: true,
      attach: 'world',
    });
    saveXrWorkspaceState(state, 'robot-a');
    expect(loadXrWorkspaceState('robot-a')).toEqual(state);
  });

  it('keeps each connection scope separate', () => {
    saveXrWorkspaceState(
      withPanelPlacement(createDefaultXrWorkspaceState(), 'panel-1', {
        pose: pose(),
        pinned: false,
        attach: 'world',
      }),
      'robot-a'
    );
    // An XR room belongs to one robot, exactly as a 2D workspace does.
    expect(loadXrWorkspaceState('robot-b').panels).toEqual({});
  });

  it('starts empty rather than throwing when storage is unreadable', () => {
    localStorage.setItem(`${XR_WORKSPACE_STORAGE_KEY}:connection:robot-a`, '{ not json');
    expect(loadXrWorkspaceState('robot-a')).toEqual(createDefaultXrWorkspaceState());
  });

  it('never writes to the 2D workspace keys', () => {
    saveXrWorkspaceState(createDefaultXrWorkspaceState(), 'robot-a');
    const touched = Object.keys(localStorage);
    expect(touched.every(key => key.startsWith(XR_WORKSPACE_STORAGE_KEY))).toBe(true);
    expect(touched.some(key => key.includes('desktop-workspace'))).toBe(false);
  });
});

describe('pruning', () => {
  it('forgets placements for panels that no longer exist', () => {
    const state = normalizeXrWorkspaceState({
      version: 1,
      panels: { live: { pose: pose() }, gone: { pose: pose() } },
      world: pose(),
    });

    const pruned = pruneXrWorkspaceState(state, ['live']);
    expect(Object.keys(pruned.panels)).toEqual(['live']);
    // The world transform is not tied to any panel and must survive.
    expect(pruned.world).toEqual(pose());
  });
});
