import { describe, expect, it, vi } from 'vitest';
import {
  buildSessionInit,
  getFloorOffset,
  getSessionModeDescriptor,
  isPassthroughBlendMode,
  requestBestReferenceSpace,
} from './sessionModes';

describe('session mode descriptors', () => {
  it('requires a floor for VR but not for AR', () => {
    // An enclosed scene with no floor reference puts the horizon in the wrong place. AR handhelds
    // commonly offer only `local`, so requiring a floor there would reject a working device.
    expect(getSessionModeDescriptor('immersive-vr').requiredFeatures).toContain('local-floor');
    expect(getSessionModeDescriptor('immersive-ar').requiredFeatures).toEqual([]);
    expect(getSessionModeDescriptor('immersive-ar').optionalFeatures).toContain('local-floor');
  });

  it('asks for dom-overlay only in AR, where it exists', () => {
    expect(getSessionModeDescriptor('immersive-ar').optionalFeatures).toContain('dom-overlay');
    expect(getSessionModeDescriptor('immersive-vr').optionalFeatures).not.toContain('dom-overlay');
  });

  it('attaches a dom overlay root only for AR, and only when one was supplied', () => {
    const root = { nodeType: 1 } as unknown as Element;
    expect(buildSessionInit('immersive-ar', root).domOverlay).toEqual({ root });
    expect(buildSessionInit('immersive-ar', null).domOverlay).toBeUndefined();
    // Passing a domOverlay init to a VR session is meaningless and some runtimes reject it.
    expect(buildSessionInit('immersive-vr', root).domOverlay).toBeUndefined();
  });

  it('does not share mutable feature arrays between calls', () => {
    const first = buildSessionInit('immersive-vr');
    (first.optionalFeatures as string[]).push('nonsense');
    expect(buildSessionInit('immersive-vr').optionalFeatures).not.toContain('nonsense');
  });
});

describe('reference space resolution', () => {
  it('takes the first space the session actually grants', async () => {
    const requestReferenceSpace = vi
      .fn()
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce({ id: 'local' });

    const result = await requestBestReferenceSpace({ requestReferenceSpace });

    // A runtime can advertise a feature and still refuse the space, so this has to fall back rather
    // than fail the whole entry.
    expect(result.type).toBe('local');
    expect(requestReferenceSpace).toHaveBeenNthCalledWith(1, 'local-floor');
    expect(requestReferenceSpace).toHaveBeenNthCalledWith(2, 'local');
  });

  it('reports every attempt when nothing works', async () => {
    const requestReferenceSpace = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(requestBestReferenceSpace({ requestReferenceSpace })).rejects.toThrow(
      /local-floor.*local.*viewer/s
    );
  });
});

describe('environment decisions', () => {
  it('offsets content to the floor only when the origin is not already there', () => {
    expect(getFloorOffset('local-floor')).toBe(0);
    expect(getFloorOffset('bounded-floor')).toBe(0);
    // `local` and `viewer` put the origin at the head, so ground-level content has to move down.
    expect(getFloorOffset('local')).toBeLessThan(0);
    expect(getFloorOffset('viewer')).toBeLessThan(0);
  });

  it('treats every non-opaque blend mode as passthrough', () => {
    // Drawing a background or a ground plane over passthrough paints over the real room.
    expect(isPassthroughBlendMode('opaque')).toBe(false);
    expect(isPassthroughBlendMode('alpha-blend')).toBe(true);
    expect(isPassthroughBlendMode('additive')).toBe(true);
    // An unknown blend mode is not a reason to assume passthrough and hide the environment.
    expect(isPassthroughBlendMode(undefined)).toBe(false);
  });
});
