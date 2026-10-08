import { expect, test, type Page } from '@playwright/test';
import { getActiveRosSubscriptionCount, getPublishedRosMessages, installRosMock, publishRosMessage } from './helpers/rosMock';

const TOPICS = [
  { name: '/battery', type: 'sensor_msgs/msg/BatteryState' },
  { name: '/robot/mode', type: 'std_msgs/msg/String' },
  { name: '/target_speed', type: 'std_msgs/msg/Float64' },
];

async function connect(page: Page) {
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}

async function openPadEditor(page: Page) {
  await page.getByRole('button', { name: 'Pad settings' }).click();
  // The template is customized into a pad of the operator's own; a saved pad is edited.
  await page.getByRole('button', { name: /^(Customize|Edit) / }).first().click();
  await expect(page.getByRole('heading', { name: 'Gamepad Editor' })).toBeVisible();
}

/** A point on the editor's grid, in cells: (0, 0) is the first cell's top-left corner. */
async function gridPoint(page: Page, x: number, y: number) {
  const cells = page.locator('.design-area .gamepad-grid .grid-background .grid-cell');
  const first = (await cells.nth(0).boundingBox())!;
  const nextColumn = (await cells.nth(1).boundingBox())!;
  const nextRow = (await cells.nth(8).boundingBox())!;
  return { x: first.x + x * (nextColumn.x - first.x), y: first.y + y * (nextRow.y - first.y) };
}

/** Drops a component from the gallery centred on the given cells. */
async function addComponent(page: Page, name: string, at: { x: number; y: number; width: number; height: number }) {
  const grid = page.locator('.design-area .gamepad-grid');
  const gridBox = (await grid.boundingBox())!;
  const point = await gridPoint(page, at.x + at.width / 2, at.y + at.height / 2);
  await page.locator('.component-card').filter({ has: page.getByText(name, { exact: true }) }).dragTo(grid, {
    targetPosition: { x: point.x - gridBox.x, y: point.y - gridBox.y },
  });
  await expect(page.getByRole('toolbar', { name: `${name} tools` })).toContainText(`${at.width}×${at.height}`);
}

/** Opens the settings of the component of this type, whose toolbar carries its label and whose dialog its type. */
async function openSettings(page: Page, type: string, typeName: string, label = typeName) {
  await page.locator(`.design-area .gamepad-component.${type}`).click();
  await page.getByRole('toolbar', { name: `${label} tools` }).getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog', { name: `Configure ${typeName}` });
}

test('value components bind to ROS in the editor, show and send live values, and survive saving, reloading, resizing and reconnecting', async ({ page }) => {
  await installRosMock(page, { topics: TOPICS });
  await page.goto('/');
  await connect(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Pad controls', exact: true }).click();
  await openPadEditor(page);

  // Room for the new components: the template's sticks go, its heartbeat stays at columns 3-4 of row 0.
  for (const stick of ['Left Stick', 'Right Stick']) {
    await page.locator('.design-area .gamepad-component.joystick').first().click();
    await page.getByRole('toolbar', { name: `${stick} tools` }).getByRole('button', { name: 'Delete' }).click();
  }
  await addComponent(page, 'Gauge', { x: 0, y: 0, width: 2, height: 2 });
  await addComponent(page, 'Setpoint', { x: 0, y: 3, width: 3, height: 1 });

  // The gauge takes a topic's type from ROS and offers the type's numeric fields.
  let settings = await openSettings(page, 'gauge', 'Gauge');
  await settings.getByLabel('Topic', { exact: true }).selectOption('/battery');
  await expect(settings.getByLabel('Message type')).toHaveValue('sensor_msgs/msg/BatteryState');
  await settings.getByLabel('Field to show').selectOption('percentage');
  await settings.getByLabel('Display label').fill('Battery');
  await settings.getByLabel('Unit').fill('%');
  await settings.getByLabel('Scale').fill('100');
  await settings.getByRole('button', { name: 'Save configuration' }).click();

  settings = await openSettings(page, 'setpoint', 'Setpoint');
  await expect(settings.getByText('Publishes')).toBeVisible();
  await settings.getByLabel('Topic', { exact: true }).selectOption('/target_speed');
  await settings.getByLabel('Display label').fill('Target speed');
  await settings.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('button', { name: 'Save Gamepad' }).click();

  // Live: the gauge shows the scaled field, the setpoint sends on request.
  const battery = page.getByRole('meter', { name: 'Battery' });
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/battery')).toBe(1);
  await publishRosMessage(page, '/battery', { percentage: 0.42, voltage: 24.1 });
  await expect(battery).toHaveAttribute('aria-valuetext', '42 %');

  await page.getByRole('button', { name: 'Increase Target speed' }).click();
  await page.getByRole('button', { name: 'Increase Target speed' }).click();
  await page.getByRole('button', { name: 'Send Target speed' }).click();
  await expect.poll(() => getPublishedRosMessages(page, '/target_speed')).toEqual([{ data: 2 }]);

  // Loading: after a reload the saved pad comes back with its bindings.
  await page.reload();
  if (await page.getByTitle('Advanced Options').isVisible()) await connect(page);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/battery')).toBe(1);
  await publishRosMessage(page, '/battery', { percentage: 0.55 });
  await expect(battery).toHaveAttribute('aria-valuetext', '55 %');

  // Editing: a resize keeps the configuration, which the settings still show.
  await openPadEditor(page);
  const gauge = page.locator('.design-area .gamepad-component.gauge');
  await gauge.click();
  const corner = (await gauge.locator('.component-resize-handle.se').boundingBox())!;
  const target = await gridPoint(page, 2.6, 1.6);
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole('toolbar', { name: 'Battery tools' })).toContainText('3×2');
  settings = await openSettings(page, 'gauge', 'Gauge', 'Battery');
  await expect(settings.getByLabel('Field path')).toHaveValue('percentage');
  await expect(settings.getByLabel('Unit')).toHaveValue('%');
  await settings.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Save Gamepad' }).click();

  const liveGauge = page.locator('.custom-gamepad-layout:not(.editing) .gamepad-component.gauge');
  // Saving authoring must not silently rebind live controls. Apply the new revision
  // explicitly, then verify presentation and subscriptions survive its clean remount.
  await expect(liveGauge).toHaveCSS('grid-column-end', 'span 2');
  await page.getByRole('button', { name: 'Activate updated controls', exact: true }).click();
  await expect(liveGauge).toHaveCSS('grid-column-start', '1');
  await expect(liveGauge).toHaveCSS('grid-column-end', 'span 3');
  await publishRosMessage(page, '/battery', { percentage: 0.61 });
  await expect(battery).toHaveAttribute('aria-valuetext', '61 %');

  // Reconnecting: one subscription again, and live values again.
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await connect(page);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/battery')).toBe(1);
  await publishRosMessage(page, '/battery', { percentage: 0.3 });
  await expect(battery).toHaveAttribute('aria-valuetext', '30 %');
});

test('a value component whose topic sends the wrong kind of value says so instead of showing it', async ({ page }) => {
  await installRosMock(page, { topics: TOPICS });
  await page.goto('/');
  await connect(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Pad controls', exact: true }).click();
  await openPadEditor(page);
  await page.locator('.design-area .gamepad-component.joystick').first().click();
  await page.getByRole('toolbar', { name: 'Left Stick tools' }).getByRole('button', { name: 'Delete' }).click();
  await addComponent(page, 'Readout', { x: 0, y: 1, width: 2, height: 1 });

  // Picking a text field for a number is refused in the settings.
  const settings = await openSettings(page, 'readout', 'Readout');
  await settings.getByLabel('Topic', { exact: true }).selectOption('/robot/mode');
  await settings.getByLabel('Field path').fill('data');
  await expect(settings.getByText('“data” is text; this component needs a number.')).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  await settings.getByRole('button', { name: 'Cancel' }).click();

  // A topic that turns out to send something else is explained on the pad.
  const readout = await openSettings(page, 'readout', 'Readout');
  await readout.getByLabel('Topic', { exact: true }).selectOption('/target_speed');
  await readout.getByLabel('Display label').fill('Speed');
  await readout.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('button', { name: 'Save Gamepad' }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/target_speed')).toBe(1);
  await publishRosMessage(page, '/target_speed', { data: 'fast' });
  await expect(page.getByText('“data” is text, not a number')).toBeVisible();
  await publishRosMessage(page, '/target_speed', { data: 1.5 });
  await expect(page.getByRole('group', { name: 'Speed: 1.50' })).toBeVisible();
});
