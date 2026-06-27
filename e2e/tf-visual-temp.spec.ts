import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('branch visual', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByLabel('Switch to TF Tree').click();
  await page.evaluate(() => {
    const transform = (parent: string, child: string) => ({
      header: { frame_id: parent, stamp: { sec: 100, nanosec: 0 } },
      child_frame_id: child,
      transform: {
        translation: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
    (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void })
      .__publishRosTopic('/tf', {
        transforms: [
          transform('map', 'left'),
          transform('map', 'right'),
          transform('left', 'left_camera'),
          transform('right', 'right_camera'),
        ],
      });
  });
  await expect(page.locator('.tf-frame-node')).toHaveCount(5);
  await page.locator('.tf-transform-edge--dynamic').nth(1).click({ force: true });
  await page.screenshot({ path: '/tmp/tf-tree-branches.png' });
});
