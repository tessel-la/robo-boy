import { useEffect, useState } from 'react';
import type { XrSupport } from './types';

const UNSUPPORTED: XrSupport = { vr: false, ar: false, isChecking: false };

/**
 * Probe one mode without letting a rejection become an unhandled error.
 *
 * `isSessionSupported` rejects rather than resolving false on some runtimes — notably for a mode the
 * browser knows about but the hardware cannot serve — so a rejection has to read as "no", not as a
 * failure of the check.
 */
const probe = async (mode: XRSessionMode): Promise<boolean> => {
  try {
    return (await navigator.xr?.isSessionSupported(mode)) === true;
  } catch {
    return false;
  }
};

/**
 * What immersive modes this device offers.
 *
 * Both modes are probed independently because supporting one implies nothing about the other: a
 * Quest 2 is effectively VR-only, an Android handheld is AR-only, a Quest 3 does both, and a desktop
 * browser does neither until an emulator is installed. Callers are expected to render no entry point
 * at all when both are false, following the capability-gate pattern used for the physical gamepad
 * API in src/features/customGamepad/components/PhysicalGamepadComponent.tsx.
 *
 * A secure context is required for WebXR, so this reports nothing available over plain HTTP on a
 * non-localhost origin — which is why the Compose stack serves HTTPS through Caddy and mkcert.
 */
export const useXrSupport = (): XrSupport => {
  const [support, setSupport] = useState<XrSupport>(() =>
    typeof navigator !== 'undefined' && navigator.xr ? { ...UNSUPPORTED, isChecking: true } : UNSUPPORTED
  );

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      setSupport(UNSUPPORTED);
      return;
    }

    let active = true;
    void (async () => {
      const [vr, ar] = await Promise.all([probe('immersive-vr'), probe('immersive-ar')]);
      if (!active) return;
      setSupport({ vr, ar, isChecking: false });
    })();

    // Some runtimes surface a headset arriving or leaving after page load. Re-probing on this event
    // keeps the entry point honest without polling.
    const handleDeviceChange = () => {
      void (async () => {
        const [vr, ar] = await Promise.all([probe('immersive-vr'), probe('immersive-ar')]);
        if (!active) return;
        setSupport({ vr, ar, isChecking: false });
      })();
    };

    navigator.xr.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      active = false;
      navigator.xr?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, []);

  return support;
};

/** True when at least one immersive mode is available. */
export const hasAnyXrSupport = (support: XrSupport): boolean => support.vr || support.ar;
