import { expect, test, type Page } from '@playwright/test';

import { installRosMock } from './helpers/rosMock';

const transform = (parent: string, child: string, sec: number) => ({
  header: { frame_id: parent, stamp: { sec, nanosec: 0 } },
  child_frame_id: child,
  transform: {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
});

async function publishTf(page: Page, topic: '/tf' | '/tf_static', transforms: unknown[]) {
  await page.evaluate(
    ({ topicName, payload }) => {
      (
        window as unknown as {
          __publishRosTopic: (topic: string, message: unknown) => void;
        }
      ).__publishRosTopic(topicName, { transforms: payload });
    },
    { topicName: topic, payload: transforms }
  );
}

test('visualizes live, static, and disconnected TF trees', async ({ page }) => {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Switch to TF Tree').click();
  await expect(page.getByTestId('tf-tree-panel')).toBeVisible();

  await publishTf(page, '/tf', [transform('map', 'base_link', 100), transform('base_link', 'laser', 101)]);
  await publishTf(page, '/tf_static', [transform('world', 'camera_mount', 1)]);

  await expect(page.getByText('5 frames')).toBeVisible();
  await expect(page.getByText('3 transforms')).toBeVisible();
  await expect(page.getByText('2 trees')).toBeVisible();
  await expect(page.locator('.tf-transform-edge--static')).toHaveCount(1);

  await page.getByLabel('Search TF frame').fill('laser');
  await page.getByLabel('Search TF frame').press('Enter');
  await expect(page.locator('.tf-frame-node--match')).toHaveCount(1);

  await page.getByLabel('Pause live TF updates').click();
  await publishTf(page, '/tf', [transform('base_link', 'imu', 102)]);
  await expect(page.getByText('5 frames')).toBeVisible();
  await page.getByLabel('Resume live TF updates').click();
  await expect(page.getByText('6 frames')).toBeVisible();

  await page.getByLabel('Static TF').uncheck();
  await expect(page.getByText('4 frames')).toBeVisible();
  await page.getByLabel('Fit TF graph to view').click();
});

test('keeps the TF tree controls, graph, and details usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Switch to TF Tree').click();
  await publishTf(page, '/tf', [transform('map', 'base_link', 100), transform('base_link', 'laser', 101)]);
  await publishTf(page, '/tf_static', [transform('world', 'camera_mount', 1)]);

  const panel = page.getByTestId('tf-tree-panel');
  const canvas = page.getByTestId('tf-tree-canvas');
  const details = page.getByLabel('TF selection details');

  await expect(panel).toBeVisible();
  await expect(page.getByLabel('Pause live TF updates')).toBeVisible();
  await expect(page.getByLabel('Fit TF graph to view')).toBeVisible();
  await expect(page.getByLabel('Search TF frame')).toBeVisible();
  await expect(page.getByLabel('Filter TF frames')).toBeVisible();
  await expect(details).toBeVisible();

  await page.locator('.tf-frame-node').filter({ hasText: 'laser' }).click();
  await expect(details).toContainText('laser');

  await expect
    .poll(async () => {
      const panelBox = await panel.boundingBox();
      const canvasBox = await canvas.boundingBox();
      const detailsBox = await details.boundingBox();
      if (!panelBox || !canvasBox || !detailsBox) return false;

      return (
        panelBox.x >= 0 &&
        panelBox.x + panelBox.width <= 390 &&
        canvasBox.height > 220 &&
        detailsBox.height > 90 &&
        detailsBox.y > canvasBox.y
      );
    })
    .toBe(true);
});
