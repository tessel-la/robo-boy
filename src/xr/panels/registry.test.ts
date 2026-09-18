import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegisteredXrPanelTypes,
  hasNativeXrPanelRenderer,
  registerXrPanelRenderer,
  resetXrPanelRenderers,
  resolveXrPanelRenderer,
  setFallbackXrPanelRenderer,
  type XrPanelRenderer,
} from './registry';

const makeRenderer = (panelType: string): XrPanelRenderer => ({
  panelType,
  create: vi.fn(() => ({ object: new THREE.Group(), dispose: vi.fn() })),
});

afterEach(() => {
  resetXrPanelRenderers();
});

describe('XR panel renderer registry', () => {
  it('returns the fallback for a panel type nothing has claimed', () => {
    const fallback = makeRenderer('*');
    setFallbackXrPanelRenderer(fallback);

    // This is what keeps the XR layer decoupled: an unknown panel — including an external one that
    // did not exist when the XR code was written — still gets a spatial representation.
    expect(resolveXrPanelRenderer('com.example.unheard-of')).toBe(fallback);
    expect(hasNativeXrPanelRenderer('com.example.unheard-of')).toBe(false);
  });

  it('prefers a native renderer over the fallback', () => {
    const fallback = makeRenderer('*');
    const native = makeRenderer('pad');
    setFallbackXrPanelRenderer(fallback);
    registerXrPanelRenderer(native);

    expect(resolveXrPanelRenderer('pad')).toBe(native);
    expect(hasNativeXrPanelRenderer('pad')).toBe(true);
    expect(resolveXrPanelRenderer('camera')).toBe(fallback);
  });

  it('lets a later registration replace an earlier one for the same type', () => {
    const first = makeRenderer('pad');
    const second = makeRenderer('pad');
    registerXrPanelRenderer(first);
    registerXrPanelRenderer(second);

    // A deployment overriding a built-in renderer should not have to patch the registry.
    expect(resolveXrPanelRenderer('pad')).toBe(second);
    expect(getRegisteredXrPanelTypes()).toEqual(['pad']);
  });

  it('resolves to null when nothing is registered and no fallback is installed', () => {
    // A programming error rather than a runtime condition — the workspace installs a fallback
    // before it resolves anything — but it must not throw here.
    expect(resolveXrPanelRenderer('camera')).toBeNull();
  });
});
