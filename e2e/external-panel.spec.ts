import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';
import { installWebRtcMock } from './helpers/webrtcMock';

test('discovers and lazily loads the standalone Hello Panel artifact', async ({ page }) => {
  let panelBundleRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/panels/hello-panel/1.0.0/index.js')) panelBundleRequests += 1;
  });

  await page.addInitScript(() => {
    const browserCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
        randomUUID: browserCrypto.randomUUID?.bind(browserCrypto),
      },
    });
  });
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Add workspace panel').first().click();
  await expect(page.getByRole('button', { name: 'Hello Panel', exact: true })).toBeVisible();
  expect(panelBundleRequests).toBe(0);

  await page.getByRole('button', { name: 'Hello Panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hello from outside Robo-Boy' })).toBeVisible();
  expect(panelBundleRequests).toBeGreaterThanOrEqual(1);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  await page.getByRole('button', { name: 'Send greeting (0)' }).click();
  await expect(page.getByRole('button', { name: 'Send greeting (1)' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panels = JSON.parse(localStorage.getItem('robo-boy-desktop-workspace-panels-v1') || '[]');
        return panels[0]?.panelState?.values?.greetings;
      })
    )
    .toBe(1);
});

test('configures an external time-series panel and plots live ROS messages', async ({ page }) => {
  await installRosMock(page, {
    topics: [{ name: '/telemetry', type: 'example_msgs/msg/Telemetry' }],
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'ROS Time Series', exact: true }).click();

  const panel = page.getByLabel('ROS Time Series panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Configure' }).click();
  await panel.getByLabel('Topic', { exact: true }).selectOption('/telemetry');
  await expect(panel.getByText('Auto-detect is enabled')).toBeVisible();
  await panel.getByText('Advanced plot settings').click();
  await panel.getByLabel('Bridge throttle').selectOption('0');
  await panel.getByLabel('Point markers').check();
  await panel.getByRole('button', { name: 'Apply' }).click();

  await page.evaluate(() => {
    (
      window as unknown as {
        __publishRosTopic: (topic: string, message: unknown) => void;
      }
    ).__publishRosTopic('/telemetry', { data: 10, nested: { value: -2 } });
    (
      window as unknown as {
        __publishRosTopic: (topic: string, message: unknown) => void;
      }
    ).__publishRosTopic('/telemetry', { data: 12.5, nested: { value: -3.25 } });
  });

  await expect(panel.getByText('Live · /telemetry')).toBeVisible();
  await expect(panel.getByText('4 samples')).toBeVisible();
  await expect(panel.getByText('12.5000')).toBeVisible();
  await expect(panel.getByText('-3.25000')).toBeVisible();
  await expect(panel.getByLabel('ROS numeric time-series chart')).toBeVisible();

  await panel.getByRole('button', { name: 'Configure' }).click();
  await expect(panel.getByRole('button', { name: 'Remove data' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Remove nested.value' })).toBeVisible();
  await panel.getByRole('button', { name: 'Remove nested.value' }).click();
  await panel.getByRole('button', { name: 'Apply' }).click();
  await page.evaluate(() => {
    (
      window as unknown as {
        __publishRosTopic: (topic: string, message: unknown) => void;
      }
    ).__publishRosTopic('/telemetry', { data: 20, nested: { value: 20 } });
  });
  await expect(panel.getByText('1 sample')).toBeVisible();
  await expect(panel.getByText('20.0000')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 360 });
  await panel.getByRole('button', { name: 'Configure' }).click();
  await panel.getByText('Advanced plot settings').click();
  const configuration = panel.getByLabel('Time series configuration');
  await expect(configuration).toBeVisible();
  await expect
    .poll(() =>
      configuration.evaluate(element => {
        const style = getComputedStyle(element);
        return style.overflowY === 'auto' && element.scrollHeight > element.clientHeight;
      })
    )
    .toBe(true);
  await panel.getByRole('button', { name: 'Cancel' }).click();

  await panel.getByRole('button', { name: 'Pause' }).click();
  await page.evaluate(() => {
    (
      window as unknown as {
        __publishRosTopic: (topic: string, message: unknown) => void;
      }
    ).__publishRosTopic('/telemetry', { data: 99, nested: { value: 99 } });
  });
  await expect(panel.getByText('Paused')).toBeVisible();
  await expect(panel.getByText('1 sample')).toBeVisible();

  await panel.getByRole('button', { name: 'Clear' }).click();
  await expect(panel.getByText('0 samples')).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('negotiates and controls the standalone WebRTC camera panel', async ({ page }) => {
  let panelBundleRequests = 0;
  let offers = 0;
  let sessionDeletes = 0;
  const authorizationHeaders: string[] = [];
  const deleteAuthorizationHeaders: string[] = [];

  page.on('request', request => {
    if (request.url().endsWith('/panels/webrtc-panel/1.2.0/index.js')) {
      panelBundleRequests += 1;
    }
  });
  await page.route('**/webrtc/**', async route => {
    const request = route.request();
    if (request.url().endsWith('/webrtc/_discovery/paths')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              name: 'manipulator_wrist_camera',
              ready: true,
              tracks: ['H264'],
            },
          ],
        }),
      });
      return;
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Expose-Headers': 'Link',
        },
      });
      return;
    }
    if (request.method() === 'DELETE') {
      sessionDeletes += 1;
      deleteAuthorizationHeaders.push(request.headers().authorization ?? '');
      await route.fulfill({ status: 200 });
      return;
    }
    offers += 1;
    authorizationHeaders.push(request.headers().authorization ?? '');
    await route.fulfill({
      status: 201,
      contentType: 'application/sdp',
      headers: { Location: '/webrtc/session/test-session' },
      body: 'v=0\r\ns=Robo-Boy WHEP answer\r\n',
    });
  });

  await installWebRtcMock(page);
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Add workspace panel').first().click();
  await expect(page.getByRole('button', { name: 'WebRTC / RTSP Camera', exact: true })).toBeVisible();
  expect(panelBundleRequests).toBe(0);
  await page.getByRole('button', { name: 'WebRTC / RTSP Camera', exact: true }).click();

  const panel = page.getByLabel('WebRTC RTSP Camera panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Live · WebRTC')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Unmute' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Fullscreen' })).toHaveCount(0);
  expect(offers).toBe(1);
  expect(panelBundleRequests).toBeGreaterThanOrEqual(1);

  await panel.getByRole('button', { name: 'Configure' }).click();
  const source = panel.getByLabel('Available stream');
  await expect(source).toHaveValue('manipulator_wrist_camera');
  await expect(panel.getByText('1 ready stream found.')).toBeVisible();
  await source.selectOption('__custom__');
  await expect(panel.getByLabel('RTSP gateway source')).toHaveValue(
    /rtsp:\/\/(127\.0\.0\.1|localhost):8554\/manipulator_wrist_camera/
  );
  await expect(panel.getByLabel('WebRTC playback (WHEP)')).toHaveValue('/webrtc/manipulator_wrist_camera/whep');
  await source.selectOption('manipulator_wrist_camera');
  await panel.getByText('Connection and display settings').click();
  await panel.getByLabel('Video fit').selectOption('cover');
  await expect(panel.getByLabel('RTT latency')).toBeChecked();
  await expect(panel.getByLabel('Packet loss')).toBeChecked();
  await panel.getByLabel('Jitter').check();
  await panel.getByLabel('Dropped frames').check();
  await panel.getByLabel('Bearer token (this session only)').fill('camera-secret');
  await panel.getByRole('button', { name: 'Apply & connect' }).click();

  await expect.poll(() => offers).toBe(2);
  await expect(panel.getByText('Live · WebRTC')).toBeVisible();
  await expect(panel.locator('video')).toHaveCSS('object-fit', 'cover');
  await expect(panel.getByText('42 ms')).toBeVisible();
  await expect(panel.getByText('8.0 ms')).toBeVisible();
  await expect(panel.getByText('2 (1.96%)')).toBeVisible();
  await expect(panel.locator('[data-role="framesDropped"]')).toHaveText('3');
  expect(authorizationHeaders.at(-1)).toBe('Bearer camera-secret');
  expect(sessionDeletes).toBeGreaterThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 360 });
  await panel.getByRole('button', { name: 'Configure' }).click();
  await panel.getByText('Connection and display settings').click();
  const configuration = panel.getByLabel('WebRTC stream configuration');
  await expect
    .poll(() =>
      configuration.evaluate(element => {
        const style = getComputedStyle(element);
        return style.overflowY === 'auto' && element.scrollHeight > element.clientHeight;
      })
    )
    .toBe(true);
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel.locator('[data-stat="bitrate"]')).toBeVisible();
  await expect(panel.locator('[data-stat="fps"]')).toBeVisible();

  await panel.getByRole('button', { name: 'Disconnect' }).click();
  await expect(panel.getByText('Disconnected')).toBeVisible();
  expect(sessionDeletes).toBeGreaterThanOrEqual(2);
  expect(deleteAuthorizationHeaders.at(-1)).toBe('Bearer camera-secret');
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});
