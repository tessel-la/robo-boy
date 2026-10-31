import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import {
  installRosMock,
  publishRosMessage,
  waitForRosSubscription,
  getActiveRosSubscriptionCount,
} from './helpers/rosMock';
import { backToLayers, openLayerSettings } from './helpers/layerSettings';

const topic = '/depth/image_rect';
const compressedTopic = `${topic}/compressedDepth`;
// Non-interlaced 16-bit grayscale PNG: every pixel is 2500 mm, with a ROS transport header.
const compressedData =
  'AAAAAAAAAAAAAAAAiVBORw0KGgoAAAANSUhEUgAAACAAAAAgEAAAAAAGgflrAAAAIElEQVR4nGPgPEIZZBg1YNSAUQNGDRg1YNSAUQOGmwEAlT40LnOIsqUAAAAASUVORK5CYII=';
const header = { frame_id: 'depth_optical', stamp: { sec: 2, nanosec: 0 } };
const info = {
  header: { ...header, stamp: { sec: 0, nanosec: 0 } },
  width: 32,
  height: 32,
  k: [32, 0, 16, 0, 32, 16, 0, 0, 1],
  p: [32, 0, 16, 0, 0, 32, 16, 0, 0, 0, 1, 0],
  d: [],
};
const depth = (mm: number) => {
  const data = Buffer.alloc(32 * 32 * 2);
  for (let i = 0; i < 32 * 32; i++) data.writeUInt16LE(mm, i * 2);
  return { header, width: 32, height: 32, encoding: '16UC1', step: 64, data: data.toString('base64') };
};

test('shares metric depth between Camera and 3D, measures pixels, renders points and restores settings', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let videoRequests = 0;
  await page.route('**/video_stream/**', route => {
    videoRequests++;
    return route.abort();
  });
  await installRosMock(page, {
    topics: [
      { name: topic, type: 'sensor_msgs/msg/Image' },
      { name: compressedTopic, type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/depth/camera_info', type: 'sensor_msgs/msg/CameraInfo' },
      { name: '/tf_static', type: 'tf2_msgs/msg/TFMessage' },
    ],
  });
  await page.goto('/');
  const connect = async () => {
    await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
  };
  const add = async (name: string) => {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  await connect();
  await add('Camera');
  const camera = page.locator('.camera-view');
  await camera.getByRole('button', { name: 'Camera settings', exact: true }).click();
  await camera.getByLabel('Camera image source').selectOption('ros');
  await camera.getByRole('button', { name: 'Close camera settings', exact: true }).click();
  await waitForRosSubscription(page, topic);
  await add('3D panel');
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Camera image (${topic})`, { exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Camera image', topic);
  await panel.getByLabel(`Projection mode for Camera image on ${topic}`).selectOption('depth');
  await panel.getByLabel('Point size', { exact: true }).fill('5');
  await waitForRosSubscription(page, '/depth/camera_info');
  await waitForRosSubscription(page, '/tf_static');
  await publishRosMessage(page, '/depth/camera_info', info);
  await publishRosMessage(page, '/tf_static', {
    transforms: [
      {
        header: { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } },
        child_frame_id: 'depth_optical',
        transform: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      },
    ],
  });
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const before = await panel.locator('canvas').screenshot();
  await publishRosMessage(page, topic, depth(5000));
  await expect(camera.getByLabel('Depth measurement')).toBeVisible();
  const canvas = camera.getByRole('img');
  await canvas.focus();
  await expect(camera.getByLabel('Depth measurement')).toHaveText('5.000 m');
  await canvas.press('ArrowLeft');
  await expect(camera.getByLabel('Depth measurement')).toHaveText('5.000 m');
  // Count changed scene pixels, independently of the Camera canvas/readout.
  const prior = await sharp(before).removeAlpha().raw().toBuffer();
  await expect
    .poll(async () => {
      const current = await sharp(await panel.locator('canvas').screenshot())
        .removeAlpha()
        .raw()
        .toBuffer();
      let changed = 0;
      for (let i = 0; i < current.length; i += 3)
        if (
          Math.abs(current[i] - prior[i]) +
            Math.abs(current[i + 1] - prior[i + 1]) +
            Math.abs(current[i + 2] - prior[i + 2]) >
          50
        )
          changed++;
      return changed;
    })
    .toBeGreaterThan(100);
  await expect.poll(() => getActiveRosSubscriptionCount(page, topic)).toBe(1);
  for (const theme of ['light', 'dark', 'solarized', 'custom']) {
    await page.evaluate(value => {
      document.documentElement.setAttribute('data-theme', value);
      if (value === 'custom') {
        document.documentElement.style.setProperty('--card-bg', '#112355');
        document.documentElement.style.setProperty('--text-color', '#f7f0df');
        document.documentElement.style.setProperty('--border-color', '#a8b7ed');
      }
    }, theme);
    await camera.screenshot({ animations: 'disabled', path: testInfo.outputPath(`depth-${theme}.png`) });
    await expect(camera.getByLabel('Depth measurement')).toHaveText('5.000 m');
  }
  const requestsAfterDepth = videoRequests;
  await camera.getByLabel('Camera topic', { exact: true }).selectOption(compressedTopic);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Camera image', topic);
  await backToLayers(panel);
  await panel.locator('[id^="visualization-topic-"]').selectOption(compressedTopic);
  await waitForRosSubscription(page, compressedTopic);
  await publishRosMessage(page, compressedTopic, {
    header,
    format: '16UC1; compressedDepth png',
    data: compressedData,
  });
  await expect(camera.getByLabel('Depth measurement')).toBeVisible();
  await canvas.focus();
  await expect(camera.getByLabel('Depth measurement')).toHaveText('2.500 m');
  expect(await getActiveRosSubscriptionCount(page, topic)).toBe(0);
  await expect.poll(() => getActiveRosSubscriptionCount(page, compressedTopic)).toBe(1);
  await publishRosMessage(page, compressedTopic, { header, format: '16UC1; compressedDepth png', data: 'AAAA' });
  await expect(camera.getByRole('status')).toContainText('valid');
  await expect(canvas).toBeHidden();
  await publishRosMessage(page, compressedTopic, {
    header,
    format: '16UC1; compressedDepth png',
    data: compressedData,
  });
  await expect(canvas).toBeVisible();
  await page.reload();
  await connect();
  await waitForRosSubscription(page, compressedTopic);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Camera image', compressedTopic);
  await expect(panel.getByLabel(`Projection mode for Camera image on ${compressedTopic}`)).toHaveValue('depth');
  await expect(panel.getByLabel('Point size', { exact: true })).toHaveValue('5');
  await expect.poll(() => getActiveRosSubscriptionCount(page, compressedTopic)).toBe(1);
  await page.getByLabel('Disconnect').click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, compressedTopic)).toBe(0);
  expect(errors).toEqual([]);
  expect(videoRequests).toBe(requestsAfterDepth);
});
