import { expect, test, type Page } from '@playwright/test';
import { McapWriter, TempBuffer } from '@mcap/core';
import { installRosMock, getPublishedRosMessages, getRosSubscriptionCount } from './helpers/rosMock';
import {
  aimXrControl,
  installXrEmulator,
  observeXrScene,
  pressXrControl,
  saveXrPanelPreview,
} from './helpers/xrEmulator';

async function connect(page: Page) {
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}
async function enter(page: Page, mode: string) {
  await observeXrScene(page);
  await page.getByRole('radio', { name: mode, exact: true }).click();
  await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
  await page.waitForTimeout(200);
}
for (const mode of ['VR', 'AR'] as const) {
  test(`Behavior tree in ${mode} uses the existing executor and shows node status`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page);
    await page.addInitScript(() => {
      const now = Date.now();
      const tree = {
        id: 'xr-tree',
        name: 'XR tree',
        nodes: [
          {
            id: 'topic',
            type: 'topic',
            position: { x: 0, y: 0 },
            data: {
              label: 'Publish test signal',
              topicName: '/xr-tree',
              messageType: 'std_msgs/msg/Float64',
              message: { data: 7 },
              publishOnce: false,
              frequencyHz: 10,
              durationMs: 30000,
            },
          },
        ],
        edges: [],
        blackboardDefaults: { target: 7 },
        createdAt: now,
        updatedAt: now,
      };
      const parent = {
        ...tree,
        id: 'xr-parent',
        name: 'XR parent',
        nodes: [{ id: 'subtree', type: 'subtree', position: { x: 0, y: 0 }, data: { label: 'Publish group', tree } }],
      };
      localStorage.setItem('robo-boy-behavior-trees', JSON.stringify([{ tree: parent, version: '1.0.0' }]));
      localStorage.setItem('robo-boy-bt-persistent-execution', 'false');
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-bt', type: 'behaviorTree', title: 'Behavior tree' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-bt']));
    });
    await connect(page);
    await enter(page, mode);
    await pressXrControl(page, 'xr-bt', 'bt-trees');
    await pressXrControl(page, 'xr-bt', 'row-0');
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-bt', 'bt-node-subtree');
    await pressXrControl(page, 'xr-bt', 'row-0');
    await expect(page.locator('.react-flow__node').getByText('Publish test signal', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-bt', 'bt-up');
    await expect(page.locator('.react-flow__node').getByText('Publish group', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-bt', 'bt-node-subtree');
    await pressXrControl(page, 'xr-bt', 'row-0');
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-bt', 'bt-trees');
    await expect(page.locator('.react-flow__node').getByText('Publish test signal', { exact: true })).toBeVisible();
    await page.waitForTimeout(100);
    await pressXrControl(page, 'xr-bt', 'bt-run');
    await expect.poll(() => getPublishedRosMessages(page, '/xr-tree')).toContainEqual({ data: 7 });
    await expect(page.getByTitle('Pause execution', { exact: true })).toBeVisible();
    await saveXrPanelPreview(page, 'xr-bt', `/tmp/robo-boy-xr-bt-${mode.toLowerCase()}.png`);
    await pressXrControl(page, 'xr-bt', 'bt-run');
    await expect(page.getByTitle('Resume execution', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    const pausedCount = (await getPublishedRosMessages(page, '/xr-tree')).length;
    await page.waitForTimeout(300);
    expect((await getPublishedRosMessages(page, '/xr-tree')).length).toBe(pausedCount);
    // Loading is locked throughout execution, even when paused.
    await pressXrControl(page, 'xr-bt', 'row-0');
    await expect(page.getByTitle('Resume execution', { exact: true })).toBeVisible();
    await pressXrControl(page, 'xr-bt', 'bt-run');
    await expect
      .poll(async () => (await getPublishedRosMessages(page, '/xr-tree')).length)
      .toBeGreaterThan(pausedCount);
    await pressXrControl(page, 'xr-bt', 'bt-stop');
    await page.waitForTimeout(150);
    const stoppedCount = (await getPublishedRosMessages(page, '/xr-tree')).length;
    await page.waitForTimeout(250);
    expect((await getPublishedRosMessages(page, '/xr-tree')).length).toBe(stoppedCount);
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });

  test(`Record & Replay in ${mode} shares remote playback and recorder controls`, async ({ page, context }) => {
    test.setTimeout(60000);
    const buffer = new TempBuffer(),
      writer = new McapWriter({ writable: buffer });
    await writer.start({ profile: '', library: 'xr-replay-test' });
    const channelId = await writer.registerChannel({
      topic: '/value',
      schemaId: 0,
      messageEncoding: 'json',
      metadata: new Map(),
    });
    for (let i = 0; i <= 30; i++)
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: BigInt(i) * 1000000000n,
        publishTime: BigInt(i) * 1000000000n,
        data: new TextEncoder().encode(JSON.stringify({ data: i })),
      });
    await writer.end();
    const bytes = buffer.get();
    await context.route('**/recordings/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/recordings/list')
        return route.fulfill({
          json: {
            version: 1,
            directory: '.',
            folders: [],
            files: [{ name: 'xr.mcap', path: 'xr.mcap', size: bytes.length, modified: 0 }],
            recordings: [],
          },
        });
      const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? '');
      if (!range) return route.fulfill({ status: 400 });
      const start = Number(range[1]),
        end = Math.min(Number(range[2]), bytes.length - 1);
      return route.fulfill({
        status: 206,
        body: Buffer.from(bytes.slice(start, end + 1)),
        headers: {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Accept-Ranges': 'bytes',
          ETag: '"xr"',
          'Content-Type': 'application/octet-stream',
        },
      });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await installXrEmulator(page);
    await installRosMock(page, { topics: [{ name: '/value', type: 'std_msgs/msg/Float64' }] });
    await page.addInitScript(() => {
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([{ id: 'xr-rr', type: 'recordReplay', title: 'Record & Replay' }])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-rr']));
      const publish = (message: unknown) =>
        (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void }).__publishRosTopic(
          '/roboboy/recorder/status',
          { data: JSON.stringify(message) }
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
        topics: ['/value'],
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
          }
          if (command.action === 'pause') status.state = 'paused';
          if (command.action === 'resume') status.state = 'recording';
          if (command.action === 'stop') status.state = 'idle';
          publish(status);
        }
      };
      setInterval(() => publish(status), 100);
    });
    await connect(page);
    const before = await getRosSubscriptionCount(page, '/roboboy/recorder/status');
    await enter(page, mode);
    expect(await getRosSubscriptionCount(page, '/roboboy/recorder/status')).toBe(before);
    await pressXrControl(page, 'xr-rr', 'rr-files');
    await page.waitForTimeout(300);
    await pressXrControl(page, 'xr-rr', 'row-2');
    await expect(page.locator('.rr-file-card').getByText('xr.mcap', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-forward');
    await expect.poll(async () => page.locator('.rr-time output').textContent()).toBe('00:10');
    await aimXrControl(page, 'xr-rr', 'rr-timeline', 0.2);
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 1));
    await expect.poll(() => page.locator('.rr-time output').textContent()).toBe('00:06');
    await aimXrControl(page, 'xr-rr', 'rr-timeline', 0.7);
    await expect.poll(() => page.locator('.rr-time output').textContent()).toBe('00:21');
    await page.evaluate(() => window.__xrDevice.controllers.right!.updateButtonValue('trigger', 0));
    await pressXrControl(page, 'xr-rr', 'rr-play');
    await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await pressXrControl(page, 'xr-rr', 'rr-play');
    await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
    await saveXrPanelPreview(page, 'xr-rr', `/tmp/robo-boy-xr-replay-${mode.toLowerCase()}.png`);
    await pressXrControl(page, 'xr-rr', 'rr-record');
    await expect(page.getByText('Ready to record', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-start');
    await expect(page.getByText('Recording in progress', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-pause');
    await expect(page.getByText('Recording paused', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-pause');
    await expect(page.getByText('Recording in progress', { exact: true })).toBeVisible();
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-split');
    await expect
      .poll(async () =>
        ((await getPublishedRosMessages(page, '/roboboy/recorder/command')) as { data: string }[]).map(
          message => JSON.parse(message.data).action
        )
      )
      .toContain('split');
    await page.waitForTimeout(150);
    await pressXrControl(page, 'xr-rr', 'rr-stop');
    await expect(page.getByText('Ready to record', { exact: true })).toBeVisible();
    await saveXrPanelPreview(page, 'xr-rr', `/tmp/robo-boy-xr-record-${mode.toLowerCase()}.png`);
    const commands = ((await getPublishedRosMessages(page, '/roboboy/recorder/command')) as { data: string }[]).map(
      message => JSON.parse(message.data).action
    );
    expect(commands).toEqual(['start', 'pause', 'resume', 'split', 'stop']);
    await page.evaluate(() => window.__xrSession.end());
    expect(errors).toEqual([]);
  });
}
