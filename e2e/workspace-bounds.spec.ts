import { expect, test } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

for (const count of [1, 4]) {
  test(`${count} desktop windows keep their complete frames inside the layout bounds`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await installRosMock(page);
    await page.addInitScript(count => {
      const panels = Array.from({ length: count }, (_, index) => ({
        id: `bounds-${index}`,
        type: ['dataExplorer', 'tfTree', 'timeSeries', 'camera'][index],
        title: `Panel ${index + 1}`,
      }));
      localStorage.setItem('robo-boy-desktop-workspace-panels-v1', JSON.stringify(panels));
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(panels.map(panel => panel.id)));
    }, count);
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.locator('.workspace-card')).toHaveCount(count);
    await expect(page.locator('.workspace-opening')).toHaveCount(0);
    const withinBounds = async () => {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const surface = document.querySelector('.workspace-layout-surface')!.getBoundingClientRect();
            return Math.max(
              ...[...document.querySelectorAll('.workspace-card')].map(card => {
                const rect = card.getBoundingClientRect();
                return Math.max(
                  surface.left - rect.left,
                  surface.top - rect.top,
                  rect.right - surface.right,
                  rect.bottom - surface.bottom,
                  0
                );
              })
            );
          })
        )
        .toBeLessThanOrEqual(0.1); // Allow fractional CSS-pixel rounding, never a missing border.
    };
    await withinBounds();
    await page.screenshot({ path: `/tmp/robo-workspace-fixed-${count}.png` });
    for (const width of [1280, 1401, 901]) {
      await page.setViewportSize({ width, height: 860 });
      await withinBounds();
    }
    if (count > 1) {
      const before = await page.locator('[data-workspace-card-id="bounds-0"]').boundingBox();
      const handle = await page
        .getByRole('separator', { name: 'Resize workspace split columns' })
        .first()
        .boundingBox();
      await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle!.x - 83, handle!.y + handle!.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => {
          const after = await page.locator('[data-workspace-card-id="bounds-0"]').boundingBox();
          return Math.abs(after!.width - before!.width);
        })
        .toBeGreaterThan(10);
      await withinBounds();
      await page.setViewportSize({ width: 1401, height: 943 });
      await withinBounds();
    }
  });
}
