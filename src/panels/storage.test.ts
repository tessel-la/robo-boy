import { describe, expect, it } from 'vitest';
import {
  PANEL_STORAGE_QUOTA_BYTES,
  PanelStorageError,
  getPanelStateSizeBytes,
  setPanelStateValue,
  validatePanelState,
} from './storage';

describe('external panel storage', () => {
  it('accepts finite JSON and reports its serialized size', () => {
    const state = setPanelStateValue({}, 'camera.frame-count', 3);

    expect(state).toEqual({ 'camera.frame-count': 3 });
    expect(getPanelStateSizeBytes(state)).toBeGreaterThan(0);
    expect(validatePanelState(state)).toBe(true);
  });

  it('rejects invalid keys, non-finite or cyclic values, and excessive depth', () => {
    expect(() => setPanelStateValue({}, '', true)).toThrowError(PanelStorageError);
    expect(() => setPanelStateValue({}, 'value', Number.NaN)).toThrowError(/finite/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => setPanelStateValue({}, 'value', cyclic as never)).toThrowError(/acyclic/);

    let deep: unknown = 'value';
    for (let index = 0; index < 22; index += 1) deep = [deep];
    expect(() => setPanelStateValue({}, 'value', deep as never)).toThrowError(/20 levels/);
  });

  it('enforces the per-instance serialized quota', () => {
    expect(() => setPanelStateValue({}, 'payload', 'x'.repeat(PANEL_STORAGE_QUOTA_BYTES))).toThrowError(
      /quota exceeded/
    );
  });
});
