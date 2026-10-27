import { expect, test } from '@playwright/test';
import {
  installRosMock,
  publishRosMessage,
  waitForRosSubscription,
  getActiveRosSubscriptionCount,
} from './helpers/rosMock';

// Opt-in real gateway test: point this at a running plain 320x240 H264 WHEP fixture.
// No mocked RTCPeerConnection, video decoder, image metadata, or robot is used.
const endpoint = process.env.ROBOBOY_TEST_WHEP_URL;
test('shares real plain WebRTC playback with calibrated 3D and persists the explicit mapping', async ({ page }) => {
  test.skip(!endpoint, 'Set ROBOBOY_TEST_WHEP_URL to a plain 320x240 H264 WHEP fixture.');
  test.setTimeout(60_000);
  const topic = '/front/image_raw';
  await installRosMock(page, {
    topics: [
      { name: topic, type: 'sensor_msgs/msg/Image' },
      { name: '/front/camera_info', type: 'sensor_msgs/msg/CameraInfo' },
      { name: '/tf_static', type: 'tf2_msgs/msg/TFMessage' },
    ],
  });
  let posts = 0,
    deletes = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && request.url() === endpoint) posts++;
    if (request.method() === 'DELETE' && request.url().startsWith(endpoint!)) deletes++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  const camera = page.locator('.camera-view');
  await camera.getByRole('button', { name: 'Camera settings', exact: true }).click();
  await camera.getByLabel('Camera image source').selectOption('webrtc');
  await camera.getByLabel('WHEP URL', { exact: true }).fill(endpoint!);
  await camera.getByLabel('WHEP URL', { exact: true }).press('Enter');
  const video = camera.getByLabel('WebRTC camera video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(320);
  await camera.getByRole('button', { name: 'Close camera settings', exact: true }).click();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Camera image (${topic})`, { exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByLabel(`Display settings for Camera image on ${topic}`, { exact: true }).click();
  await expect(panel.getByLabel(`TF timing for Camera image on ${topic}`)).toHaveValue('latest');
  await panel.getByLabel(`Image source for Camera image on ${topic}`).selectOption('webrtc');
  await panel.getByLabel('WHEP URL', { exact: true }).fill(endpoint!);
  await panel.getByLabel('WHEP URL', { exact: true }).press('Enter');
  await waitForRosSubscription(page, '/front/camera_info');
  await waitForRosSubscription(page, '/tf_static');
  await publishRosMessage(page, '/front/camera_info', {
    header: { frame_id: 'optical', stamp: { sec: 0, nanosec: 0 } },
    width: 320,
    height: 240,
    distortion_model: 'plumb_bob',
    d: [0, 0, 0, 0, 0],
    k: [320, 0, 160, 0, 320, 120, 0, 0, 1],
    p: [320, 0, 160, 0, 0, 320, 120, 0, 0, 0, 1, 0],
  });
  await publishRosMessage(page, '/tf_static', {
    transforms: [
      {
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        child_frame_id: 'optical',
        transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      },
    ],
  });
  await expect(panel.getByRole('status').filter({ hasText: 'not time-synchronized' })).toBeVisible();
  await expect(panel.getByRole('status').filter({ hasText: /Waiting|invalid|match CameraInfo/ })).toHaveCount(0);
  expect(posts).toBe(1);
  expect(await getActiveRosSubscriptionCount(page, topic)).toBe(0);
  // Removing 3D leaves native playback and the one WHEP session alive.
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const time = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(time);
  expect(deletes).toBe(0);
  // Wait for the existing debounced workspace persistence before reloading.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.entries(localStorage).some(([key, value]) => {
          if (!key.includes('desktop-workspace-panels-v1')) return false;
          try {
            const panels = JSON.parse(value);
            return (
              panels.length === 1 &&
              panels[0].type === 'camera' &&
              panels[0].panelState?.values.imageSource === 'webrtc'
            );
          } catch {
            return false;
          }
        })
      )
    )
    .toBe(true);
  // Camera settings survive reload and do not need a ROS image publisher to play.
  await page.reload();
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await camera.getByRole('button', { name: 'Camera settings', exact: true }).click();
  await expect(page.getByLabel('Camera image source')).toHaveValue('webrtc');
  await expect
    .poll(() => page.getByLabel('WebRTC camera video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(320);
  await page.getByRole('button', { name: 'Remove Camera', exact: true }).click();
  await expect.poll(() => deletes).toBeGreaterThan(0);
});
