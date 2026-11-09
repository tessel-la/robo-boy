import { openAppTool } from './helpers/navigation';
import { McapWriter, TempBuffer } from '@mcap/core';
import { expect, test, type Page } from '@playwright/test';
import { installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';
import { openLayerSettings } from './helpers/layerSettings';
const topic = '/robot/joint_states';
const description = '/robot/robot_description';
const urdf = `<robot name="robot">
  <joint name="elbow" type="revolute"><limit lower="-1.57" upper="1.57" velocity="2" effort="20"/></joint>
  <joint name="gripper" type="prismatic"><limit lower="0" upper="0.08" velocity="0.1" effort="5"/></joint>
  <joint name="wheel" type="continuous"><limit velocity="10" effort="10"/></joint>
</robot>`;
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 15_000 });
}
async function send(page: Page, position = 0.5) {
  await waitForRosSubscription(page, topic);
  await waitForRosSubscription(page, description);
  await publishRosMessage(page, description, { data: urdf });
  await publishRosMessage(page, topic, {
    name: ['elbow', 'gripper', 'wheel', 'unknown_joint'],
    position: [position, 0.04, 10, 0.75],
    velocity: [0.3, 0.01, 2, 1],
    effort: [2, 1, 3, 0],
  });
}
test('shows live joint limits, moves/resizes within 3D and persists display settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installRosMock(page, {
    topics: [
      { name: topic, type: 'sensor_msgs/msg/JointState' },
      { name: description, type: 'std_msgs/msg/String' },
    ],
  });
  await page.goto('/');
  await connect(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Joint states (${topic})`, { exact: true }).click();
  await send(page);
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const overlay = panel.getByRole('region', { name: `Joint states on ${topic}` });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('meter', { name: 'elbow position' })).toHaveAttribute('aria-valuenow', '0.5');
  await expect(overlay).toContainText('Min -1.570 rad');
  await expect(overlay).toContainText('Max 0.080 m');
  await expect(overlay).toContainText('Continuous · no position limits');
  await expect(overlay).toContainText('Limits unavailable');
  await send(page, 2);
  await expect(overlay).toContainText('Outside position limits');
  const before = (await overlay.boundingBox())!;
  const handle = overlay.getByRole('button', { name: `Move joint states on ${topic}` });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + 50, h.y + 10);
  await page.mouse.down();
  await page.mouse.move(h.x - 70, h.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await overlay.boundingBox())!.x).toBeLessThan(before.x - 50);
  const resize = overlay.getByRole('button', { name: `Resize joint states on ${topic}` });
  await resize.focus();
  await resize.press('Shift+ArrowRight');
  await expect.poll(async () => (await overlay.boundingBox())!.width).toBeGreaterThan(before.width + 10);
  await resize.press('Shift+ArrowDown');
  const corner = (await resize.boundingBox())!;
  await page.mouse.move(corner.x + 10, corner.y + 10);
  await page.mouse.down();
  await page.mouse.move(corner.x + 30, corner.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await overlay.boundingBox())!.width).toBeGreaterThan(before.width + 30);
  const placed = (await overlay.boundingBox())!;
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Joint states', topic);
  await panel.getByLabel('Angle units', { exact: true }).selectOption('deg');
  await panel.getByLabel('Background opacity', { exact: true }).fill('0.5');
  await panel.getByLabel(`Show velocity for Joint states on ${topic}`, { exact: true }).check();
  await panel.getByLabel(`Show effort for Joint states on ${topic}`, { exact: true }).check();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await send(page);
  await expect(overlay.getByRole('meter', { name: 'elbow position' })).toHaveAttribute('aria-valuetext', '28.648 deg');
  await expect(overlay).toContainText('Velocity 17.189 deg/s');
  await expect(overlay).toContainText('Effort 2.000 N·m');
  await expect(overlay).toHaveCSS('--joint-background-opacity', '50%');
  await panel.screenshot({ path: '/tmp/roboboy-joint-overlay.png' });
  await expect(overlay.getByText('Stale reading').first()).toBeVisible({ timeout: 5000 });
  await page.reload();
  await connect(page);
  await send(page);
  await expect(overlay.getByRole('meter', { name: 'elbow position' })).toHaveAttribute('aria-valuetext', '28.648 deg');
  await expect.poll(async () => (await overlay.boundingBox())!.width).toBeCloseTo(placed.width, 0);
  await expect.poll(async () => (await overlay.boundingBox())!.x).toBeCloseTo(placed.x, 0);
  await page.setViewportSize({ width: 600, height: 800 });
  await expect
    .poll(async () => {
      const p = (await panel.boundingBox())!,
        o = (await overlay.boundingBox())!;
      return o.x >= p.x && o.y >= p.y && o.x + o.width <= p.x + p.width && o.y + o.height <= p.y + p.height;
    })
    .toBe(true);
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Joint states', topic);
  await panel.getByLabel('Filter joint names', { exact: true }).fill('gripper');
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(overlay).not.toContainText('elbow');
  await expect(overlay).toContainText('gripper');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await openLayerSettings(panel, 'Joint states', topic);
  await panel.getByRole('button', { name: 'Reset overlay position and size', exact: true }).click();
  await panel.getByLabel(`Show Joint states on ${topic}`, { exact: true }).uncheck();
  await expect(overlay).toHaveCount(0);
  await panel.getByLabel(`Show Joint states on ${topic}`, { exact: true }).check();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(overlay).toBeVisible();
  await expect.poll(async () => (await overlay.boundingBox())!.width).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});

test('uses recorded JointState and URDF data and clears future values on backward seeks', async ({ page }) => {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer });
  await writer.start({ profile: '', library: 'joint-overlay-test' });
  for (const [name, type, messages] of [
    [description, 'std_msgs/msg/String', [{ data: urdf }]],
    [
      topic,
      'sensor_msgs/msg/JointState',
      [
        { name: ['elbow'], position: [0.1] },
        { name: ['elbow', 'future_joint'], position: [1, 4] },
      ],
    ],
  ] as const) {
    const schemaId = await writer.registerSchema({
      name: type,
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{}'),
    });
    const channelId = await writer.registerChannel({
      topic: name,
      schemaId,
      messageEncoding: 'json',
      metadata: new Map(),
    });
    for (let i = 0; i < messages.length; i++) {
      const time = BigInt(i * 10) * 1_000_000_000n;
      await writer.addMessage({
        channelId,
        sequence: i,
        logTime: time,
        publishTime: time,
        data: new TextEncoder().encode(JSON.stringify(messages[i])),
      });
    }
  }
  await writer.end();
  await page.goto('/');
  await openAppTool(page, 'Recordings');
  const replay = page.getByRole('region', { name: 'Record & Replay', exact: true });
  await replay
    .getByLabel('Open MCAP recording')
    .setInputFiles({ name: 'joints.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(buffer.get()) });
  await expect(replay.getByRole('button', { name: 'Play recording', exact: true })).toBeEnabled();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  const panel = page.locator('.visualization-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('tab', { name: /^Visualizations/ }).click();
  await panel.getByRole('button', { name: 'Add visualization', exact: true }).click();
  await page.getByTitle(`Add Joint states (${topic})`, { exact: true }).click();
  await panel.getByRole('button', { name: 'Close settings', exact: true }).click();
  const overlay = panel.getByRole('region', { name: `Joint states on ${topic}` });
  await expect(overlay.getByRole('meter', { name: 'elbow position' })).toHaveAttribute('aria-valuenow', '0.1');
  const seek = replay.getByRole('slider', { name: 'Playback position', exact: true });
  await seek.fill('10');
  await expect(overlay).toContainText('future_joint');
  await seek.fill('0');
  await expect(overlay.getByRole('meter', { name: 'elbow position' })).toHaveAttribute('aria-valuenow', '0.1');
  await expect(overlay).not.toContainText('future_joint');
  await page.waitForTimeout(2500);
  await expect(overlay).not.toContainText('Stale reading');
});
