import { expect, test } from '@playwright/test';
import { McapWriter, TempBuffer } from '@mcap/core';
import { installRosMock } from './helpers/rosMock';

for (const secureContext of [true, false]) {
  test(`starts and stops recording ${secureContext ? 'with' : 'without'} crypto.randomUUID`, async ({ page }) => {
    await installRosMock(page, { topics: [{ name: '/value', type: 'std_msgs/msg/Float64' }] });
    await page.addInitScript(secure => {
      if (!secure) Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined });
      const publish = (topic: string, message: unknown) =>
        (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void }).__publishRosTopic(
          topic,
          message
        );
      const status = {
        version: 1,
        state: 'idle',
        root: '/recordings',
        path: '',
        messages: 0,
        bytes: 0,
        dropped: 0,
        elapsed: 0,
        topics: [] as string[],
        requestId: '',
      };
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        send(data: string) {
          super.send(data);
          const message = JSON.parse(data);
          if (message.op !== 'publish' || message.topic !== '/roboboy/recorder/command') return;
          const command = JSON.parse(message.msg.data);
          status.requestId = command.id;
          if (command.action === 'start') {
            status.state = 'recording';
            status.path = `/recordings/${command.options.name}`;
            status.messages = 12;
            status.bytes = 96;
            status.topics = ['/value'];
          } else if (command.action === 'stop') status.state = 'idle';
          publish('/roboboy/recorder/status', { data: JSON.stringify(status) });
        }
      };
      setInterval(() => publish('/roboboy/recorder/status', { data: JSON.stringify(status) }), 100);
    }, secureContext);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Record & Replay', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Record & Replay', exact: true });
    await panel.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(panel.getByText('Ready to record')).toBeVisible();
    await panel.getByRole('button', { name: 'Start recording', exact: true }).click();
    await expect(panel.getByText('Recording in progress')).toBeVisible();
    await expect(panel.getByText(/12 messages/)).toBeVisible();
    await panel.getByRole('button', { name: 'Stop & save', exact: true }).click();
    await expect(panel.getByText('Ready to record')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('opens a local MCAP through the replay worker without a ROS connection', async ({ page }) => {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'record-replay-test' });
  const channelId = await writer.registerChannel({
    topic: '/value',
    schemaId: 0,
    messageEncoding: 'json',
    metadata: new Map(),
  });
  for (let i = 0; i <= 10; i++) {
    await writer.addMessage({
      channelId,
      sequence: i,
      logTime: BigInt(i) * 1_000_000_000n,
      publishTime: BigInt(i) * 1_000_000_000n,
      data: new TextEncoder().encode(JSON.stringify({ data: i })),
    });
  }
  await writer.end();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open local recordings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await panel
    .getByLabel('Open MCAP recording')
    .setInputFiles({ name: 'sample.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(buffer.get()) });
  await expect(panel.getByText('sample.mcap', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  await panel.getByText('Topics in this recording').click();
  await expect(panel.getByText('/value', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await expect(panel.locator('output')).not.toHaveText('00:00');
  await panel.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
