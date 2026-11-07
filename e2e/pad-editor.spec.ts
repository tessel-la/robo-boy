import { expect, test, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

async function connect(page: Page) {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.getByRole('status', { name: /^Connected to / })).toHaveCount(0);
}

async function addPadPanel(page: Page) {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Pad controls', exact: true }).click();
}

// The template pad: sticks at columns 0-2 and 5-7 over rows 1-3, a heartbeat at columns 3-4 of row 0.
async function openPadEditor(page: Page) {
  await connect(page);
  await addPadPanel(page);
  await page.getByRole('button', { name: 'Pad settings' }).click();
  await page.getByRole('button', { name: /^Customize / }).click();
  await expect(page.getByRole('heading', { name: 'Gamepad Editor' })).toBeVisible();
  // The gallery would cover part of the grid on a narrow window; these tests work the grid itself.
  return page.locator('.design-area .gamepad-grid');
}

const leftStick = (page: Page) => page.locator('.design-area .gamepad-component.joystick').first();

test('runtime Pad fills its tile at desktop and mobile sizes', async ({ page }, testInfo) => {
  await connect(page);
  await addPadPanel(page);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const body = page.locator('.workspace-pad-body').first();
    const layout = body.locator('.custom-gamepad-layout');
    await expect(layout).toBeVisible();
    await expect.poll(async () => {
      const outer = (await body.boundingBox())!;
      const inner = (await layout.boundingBox())!;
      return inner.width / outer.width;
    }).toBeGreaterThan(0.85);
    expect(await body.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`pad-${viewport.width}.png`) });
  }
});

test('a selected component shows its frame, corner and edge handles and a toolbar in the app\'s own style', async ({ page }) => {
  await openPadEditor(page);
  await leftStick(page).click();

  const toolbar = page.getByRole('toolbar', { name: 'Left Stick tools' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText('3×3');
  await expect(toolbar.getByRole('button', { name: 'Settings' }).locator('svg')).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Delete' }).locator('svg')).toBeVisible();
  await expect(leftStick(page).locator('.component-resize-handle')).toHaveCount(8);

  const colours = await leftStick(page).evaluate(element => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim(),
    frame: getComputedStyle(element).borderTopColor,
    corner: getComputedStyle(element.querySelector('.component-resize-handle.nw')!, '::after').borderTopColor,
  }));
  expect(colours.frame).toBe(colours.corner);
  expect(colours.primary.length).toBeGreaterThan(0);

  // A second click keeps it selected; the empty grid clears the selection.
  await leftStick(page).click();
  await expect(toolbar).toBeVisible();
  await page.locator('.design-area').click({ position: { x: 4, y: 4 } });
  await expect(toolbar).toHaveCount(0);
});

test('resizing follows the pointer by whole cells and stops at the neighbouring component', async ({ page }) => {
  await openPadEditor(page);
  await leftStick(page).click();
  const corner = leftStick(page).locator('.component-resize-handle.se');
  const box = (await corner.boundingBox())!;

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Well past the right stick, and past the bottom of the grid, while staying inside the window.
  await page.mouse.move(Math.min(box.x + 450, page.viewportSize()!.width - 10), box.y + 120, { steps: 12 });
  await expect(leftStick(page).locator('.component-size-badge')).toHaveText('5 × 3');
  await page.mouse.up();

  await expect(page.getByRole('toolbar', { name: 'Left Stick tools' })).toContainText('5×3');
});

test('a component too large for the room left is placed at the largest size that fits there', async ({ page }) => {
  const grid = await openPadEditor(page);
  const gridBox = (await grid.boundingBox())!;
  const cells = grid.locator('.grid-background .grid-cell');
  // Column 1 of row 0 is free; the 6x4 physical gamepad can only have columns 0-2 of that row.
  const target = (await cells.nth(1).boundingBox())!;

  await page.getByText('Physical Gamepad', { exact: true }).first().dragTo(grid, {
    targetPosition: { x: target.x - gridBox.x + target.width / 2, y: target.y - gridBox.y + target.height / 2 },
  });

  const added = page.locator('.design-area .gamepad-component.physical-gamepad');
  await expect(added).toHaveCount(1);
  await expect(page.getByRole('toolbar', { name: /Physical Gamepad tools/ })).toContainText('3×1');
  const addedBox = (await added.boundingBox())!;
  expect(addedBox.x).toBeGreaterThanOrEqual(gridBox.x);
  expect(addedBox.x + addedBox.width).toBeLessThanOrEqual(gridBox.x + gridBox.width);
});

test('a pad in a narrow panel shrinks to fit it instead of overflowing', async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 640 });
  await connect(page);
  await addPadPanel(page);

  const layout = page.locator('.custom-gamepad-layout:not(.editing)').first();
  await expect(layout.locator('.gamepad-component').first()).toBeVisible();
  const fit = await layout.evaluate(element => {
    const grid = element.querySelector<HTMLElement>('.gamepad-grid')!;
    const bounds = element.getBoundingClientRect();
    const components = [...grid.querySelectorAll<HTMLElement>('.gamepad-component')].map(c => c.getBoundingClientRect());
    return {
      overflowX: grid.scrollWidth - grid.clientWidth,
      overflowY: grid.scrollHeight - grid.clientHeight,
      inside: components.every(r => r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1),
    };
  });
  expect(fit).toEqual({ overflowX: 0, overflowY: 0, inside: true });
});
