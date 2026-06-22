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
  await expect(page.getByText('3 frames')).toBeVisible();
  await page.getByLabel('Fit TF graph to view').click();
});
