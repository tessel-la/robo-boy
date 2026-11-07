import { expect, test } from '@playwright/test';
import { getRosSubscriptionCount, installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';

test('pose and cloud layer status recovers with timestamped TF without rebuilding subscriptions', async ({ page }) => {
  await installRosMock(page, {
    topics: [
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
      { name: '/pose', type: 'geometry_msgs/msg/PoseStamped' },
      { name: '/points', type: 'sensor_msgs/msg/PointCloud2' },
    ],
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const title of ['Add PoseStamped (/pose)', 'Add Pointcloud (/points)']) {
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByTitle(title, { exact: true }).click();
  }
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await waitForRosSubscription(page, '/pose');
  await waitForRosSubscription(page, '/points');
  await waitForRosSubscription(page, '/tf');
  const counts = await Promise.all(['/pose', '/points', '/tf'].map(topic => getRosSubscriptionCount(page, topic)));
  const pose = {
    header: { frame_id: 'sensor', stamp: { sec: 2, nanosec: 0 } },
    pose: { position: { x: 1, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  };
  await publishRosMessage(page, '/pose', pose);
  await publishRosMessage(page, '/points', {
    header: pose.header,
    width: 1,
    height: 1,
    point_step: 12,
    row_step: 12,
    fields: ['x', 'y', 'z'].map((name, index) => ({ name, offset: index * 4, datatype: 7, count: 1 })),
    data: [...new Uint8Array(new Float32Array([1, 2, 3]).buffer)],
  });
  await expect(panel.locator('.visualization-status')).toHaveCount(2);
  for (const sec of [1, 3]) {
    await publishRosMessage(page, '/tf', {
      transforms: [
        {
          header: { frame_id: 'map', stamp: { sec, nanosec: 0 } },
          child_frame_id: 'sensor',
          transform: { translation: { x: sec, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
        },
      ],
    });
  }
  await expect(panel.locator('.visualization-status')).toHaveCount(0);
  await publishRosMessage(page, '/pose', { ...pose, header: { frame_id: '', stamp: pose.header.stamp } });
  await expect(panel.getByRole('status')).toHaveText('Message frame_id is missing.');
  expect(await Promise.all(['/pose', '/points', '/tf'].map(topic => getRosSubscriptionCount(page, topic)))).toEqual(
    counts
  );
  await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});
