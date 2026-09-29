import { writeFile } from 'node:fs/promises';
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

export async function pressXrControl(page: Page, panelId: string, id: string) {
  await page.evaluate(
    async ({ panelId, id }) => {
      const path = '/src/xr/ui/SurfaceInteraction.ts';
      const { SurfaceInteraction } = await import(/* @vite-ignore */ path);
      let found = false;
      const panel = window.__xrScene.uiGroup.children.find(object => object.userData.placementId === panelId);
      if (!panel) throw new Error('Missing spatial frame');
      panel.traverse(object => {
        const surface = object.userData.xrSurface;
        const item = surface?.getItem(id);
        if (!item || found) return;
        found = true;
        new SurfaceInteraction().activate({
          object,
          uv: {
            x: (item.x + item.w / 2) / surface.pixelWidth,
            y: 1 - (item.y + item.h / 2) / surface.pixelHeight,
          },
        });
      });
      if (!found) throw new Error(`Missing spatial control: ${id}`);
    },
    { panelId, id }
  );
}

export async function saveXrPanelPreview(page: Page, panelId: string, path: string): Promise<void> {
  // Render the actual scene into a review image; the headset's canvas is intentionally hidden in DOM.
  const image = await page.evaluate(async panelId => {
    const threePath = '/node_modules/.vite/deps/three.js';
    const THREE = await import(/* @vite-ignore */ threePath);
    const scene = window.__xrScene;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(1440, 1000);
    const camera = new THREE.PerspectiveCamera(55, 1.44, 0.01, 100);
    const panel = scene.uiGroup.children.find(object => object.userData.placementId === panelId)!;
    const center = panel.getWorldPosition(new THREE.Vector3());
    camera.position.set(center.x + 0.2, center.y + 0.08, center.z + 1.65);
    camera.lookAt(center.x + 0.25, center.y, center.z);
    renderer.render(scene.scene, camera);
    const image = renderer.domElement.toDataURL('image/png').split(',')[1];
    renderer.dispose();
    return image;
  }, panelId);
  await writeFile(path, Buffer.from(image, 'base64'));
}
