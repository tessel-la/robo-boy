import { expect, test } from '@playwright/test';
import { getRosSubscriptionCount, installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';

test('saves mesh opacity per layer and updates it without resubscribing', async ({ page }) => {
  await installRosMock(page, {
    topics: [
      { name: '/robot_description', type: 'std_msgs/msg/String' },
      { name: '/objects', type: 'visualization_msgs/msg/MarkerArray' },
    ],
  });
  await page.goto('/');
  const connect = async () => {
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
  };
  await connect();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  for (const title of ['Add URDF (default: /robot_description)', 'Add Mesh markers (/objects)']) {
    await panel.getByRole('tab', { name: /^Visualizations/ }).click();
    await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByTitle(title, { exact: true }).click();
  }
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await waitForRosSubscription(page, '/robot_description');
  await waitForRosSubscription(page, '/objects');
  await publishRosMessage(page, '/robot_description', {
    data: '<robot name="test"><link name="map"><visual><geometry><box size="1 1 1"/></geometry></visual></link></robot>',
  });
  const counts = await Promise.all(
    ['/robot_description', '/objects'].map(topic => getRosSubscriptionCount(page, topic))
  );
  const robot = panel.getByLabel('Mesh opacity for URDF on /robot_description');
  const objects = panel.getByLabel('Mesh opacity for Mesh markers on /objects');
  await expect(robot).toHaveValue('1');
  await robot.fill('0.45');
  await expect(objects).toHaveValue('1');
  await objects.fill('0.7');
  expect(
    await Promise.all(['/robot_description', '/objects'].map(topic => getRosSubscriptionCount(page, topic)))
  ).toEqual(counts);
  await page.reload();
  await connect();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await expect(robot).toHaveValue('0.45');
  await expect(objects).toHaveValue('0.7');
});
