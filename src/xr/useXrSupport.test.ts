import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasAnyXrSupport, useXrSupport } from './useXrSupport';

const stubXr = (isSessionSupported: (mode: XRSessionMode) => Promise<boolean>) => {
  vi.stubGlobal('navigator', {
    ...navigator,
    xr: { isSessionSupported: vi.fn(isSessionSupported), addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useXrSupport', () => {
  it('reports nothing available when the browser has no WebXR at all', async () => {
    vi.stubGlobal('navigator', { ...navigator, xr: undefined });
    const { result } = renderHook(() => useXrSupport());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current).toEqual({ vr: false, ar: false, isChecking: false });
    expect(hasAnyXrSupport(result.current)).toBe(false);
  });

  it('probes the two modes independently', async () => {
    // Supporting one implies nothing about the other: a Quest 2 is effectively VR-only and an
    // Android handheld is AR-only, so a single boolean would be wrong on both.
    stubXr(async mode => mode === 'immersive-ar');
    const { result } = renderHook(() => useXrSupport());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.vr).toBe(false);
    expect(result.current.ar).toBe(true);
    expect(hasAnyXrSupport(result.current)).toBe(true);
  });

  it('reports both when a device serves both', async () => {
    stubXr(async () => true);
    const { result } = renderHook(() => useXrSupport());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current).toEqual({ vr: true, ar: true, isChecking: false });
  });

  it('treats a rejected probe as unsupported rather than an error', async () => {
    // Some runtimes reject for a mode they know about but cannot serve. That has to read as "no",
    // not as an unhandled rejection that leaves the entry point stuck checking.
    stubXr(async mode => {
      if (mode === 'immersive-ar') throw new Error('not available');
      return true;
    });
    const { result } = renderHook(() => useXrSupport());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.vr).toBe(true);
    expect(result.current.ar).toBe(false);
  });

  it('stops checking once resolved so the entry point does not flicker', async () => {
    stubXr(async () => false);
    const { result } = renderHook(() => useXrSupport());

    expect(result.current.isChecking).toBe(true);
    await waitFor(() => expect(result.current.isChecking).toBe(false));
  });
});
