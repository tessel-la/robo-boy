import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type * as IWER from 'iwer';
import type { XrSceneManager } from '../../src/xr/XrSceneManager';

declare global {
  interface Window {
    IWER: typeof IWER;
    __xrDevice: IWER.XRDevice;
    __xrSession: XRSession;
    __xrScene: XrSceneManager;
  }
}

export async function installXrEmulator(page: Page): Promise<void> {
  const require = createRequire(import.meta.url);
  await page.addInitScript({ path: resolve(dirname(require.resolve('iwer')), '../build/iwer.min.js') });
  await page.addInitScript(() => {
    const { XRDevice, metaQuest3 } = window.IWER;
    window.__xrDevice = new XRDevice(metaQuest3, { stereoEnabled: false });
    window.__xrDevice.installRuntime({ forceInstall: true, polyfillLayers: false });
    const requestSession = navigator.xr!.requestSession.bind(navigator.xr);
    navigator.xr!.requestSession = async (...args) => {
      const session = await requestSession(...args);
      window.__xrSession = session;
      return session;
    };
  });
}

/** Inspect the real scene without adding a production debug API. Requires the Vite dev server. */
export async function observeXrScene(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const modulePath = '/src/xr/XrSceneManager.ts';
    const { XrSceneManager } = await import(/* @vite-ignore */ modulePath);
    const start = XrSceneManager.prototype.start;
    XrSceneManager.prototype.start = function (...args: unknown[]) {
      window.__xrScene = this;
      return start.apply(this, args);
    };
  });
}
