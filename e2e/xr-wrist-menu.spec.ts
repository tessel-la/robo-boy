import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene } from './helpers/xrEmulator';

const menuState = (page: Page) =>
  page.evaluate(() => {
    const root = window.__xrScene.uiGroup.getObjectByName('xr-wrist-menu')!;
    return {
      open: root.visible && root.getObjectByName('xr-wrist-menu-content')!.parent!.visible,
      launcher: root.visible && root.getObjectByName('xr-wrist-menu-launcher')!.visible,
    };
  });

async function aimMenu(page: Page, meshName: string, itemId: string) {
  await page.evaluate(
    async ({ meshName, itemId }) => {
      const path = '/node_modules/.vite/deps/three.js';
      const THREE = await import(/* @vite-ignore */ path);
      const mesh = window.__xrScene.uiGroup.getObjectByName(meshName)!;
      const surface = mesh.userData.xrSurface;
      const item = surface.getItem(itemId);
      mesh.updateWorldMatrix(true, false);
      const point = mesh.localToWorld(
        new THREE.Vector3(
          ((item.x + item.w / 2) / surface.pixelWidth - 0.5) * surface.width,
          (0.5 - (item.y + item.h / 2) / surface.pixelHeight) * surface.height,
          0
        )
      );
      const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
      const origin = point.clone().add(new THREE.Vector3(0, 0, 0.5).applyQuaternion(rotation));
      const hand = window.__xrDevice.controllers.right!;
      hand.position.set(origin.x, origin.y, origin.z);
      hand.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    },
    { meshName, itemId }
  );
  await page.waitForTimeout(100);
}

for (const mode of ['VR', 'AR'] as const) {
  test(`wrist menu in ${mode} opens explicitly from left X or the wrist button`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      localStorage.setItem('robo-boy-desktop-workspace-panels-v1', '[]');
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', '[]');
    });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await observeXrScene(page);
    await page.getByRole('radio', { name: mode, exact: true }).click();
    await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
    await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
    await page.evaluate(() => {
      window.__xrDevice.controllers.left!.position.set(-0.2, 1.4, -0.4);
    });
    await expect.poll(() => menuState(page)).toEqual({ open: false, launcher: true });
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('x-button', 1));
    await expect.poll(() => menuState(page)).toEqual({ open: true, launcher: false });
    await page.waitForTimeout(350); // Holding X through many frames must not repeatedly toggle.
    expect((await menuState(page)).open).toBe(true);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('x-button', 0));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('x-button', 1));
    await expect.poll(() => menuState(page)).toEqual({ open: false, launcher: true });
    await page.evaluate(() => {
      window.__xrDevice.controllers.left!.updateButtonValue('x-button', 0);
      window.__xrDevice.controllers.left!.position.y = 0.7;
    });
    await expect.poll(() => menuState(page)).toEqual({ open: false, launcher: false });
    await page.evaluate(() => {
      window.__xrDevice.controllers.left!.position.y = 1.4;
    });
    await expect.poll(() => menuState(page)).toEqual({ open: false, launcher: true });
    await aimMenu(page, 'xr-wrist-menu-launcher', 'wrist-menu-toggle');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
    await expect.poll(() => menuState(page)).toEqual({ open: true, launcher: false });
    await aimMenu(page, 'xr-wrist-menu-content', 'row-0');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
    await expect(page.locator('[data-workspace-card-id]')).toHaveCount(1);
    await page.evaluate(() => window.__xrDevice.controllers.left!.updateButtonValue('x-button', 1));
    await expect.poll(() => menuState(page)).toEqual({ open: false, launcher: true });
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });
}
