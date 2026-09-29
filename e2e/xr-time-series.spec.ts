import { expect, test } from '@playwright/test';
import { getActiveRosSubscriptionCount, installRosMock } from './helpers/rosMock';
import { installXrEmulator, observeXrScene, pressXrControl, saveXrPanelPreview } from './helpers/xrEmulator';

test('native Time Series shares ROS history and settings, then restores desktop drawing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installXrEmulator(page);
  await installRosMock(page, { topics: [{ name: '/telemetry', type: 'Test' }] });
  await page.addInitScript(() => {
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([
        {
          id: 'xr-series',
          type: 'timeSeries',
          title: 'Time Series',
          panelState: {
            schemaVersion: 1,
            panelId: 'timeSeries',
            values: {
              config: {
                schemaVersion: 4,
                series: [
                  {
                    id: 'velocity',
                    topic: '/telemetry',
                    messageType: 'Test',
                    fieldPath: 'velocity',
                    label: 'Velocity',
                    unit: 'm/s',
                  },
                ],
              },
            },
          },
        },
      ])
    );
    localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['xr-series']));
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Desktop workspace')).toBeVisible();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/telemetry')).toBe(1);
  await observeXrScene(page);
  await page.getByRole('button', { name: /Enter XR Workspace/ }).click();
  await expect.poll(() => page.evaluate(() => window.__xrScene?.renderer.xr.isPresenting)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        let found = false;
        window.__xrScene.uiGroup.traverse(object => {
          if (object.userData.xrSurface?.getItem('signal-velocity')) found = true;
        });
        return found;
      })
    )
    .toBe(true);
  expect(await getActiveRosSubscriptionCount(page, '/telemetry')).toBe(1);
  await page.evaluate(() => {
    for (let index = 0; index < 80; index++)
      window.__publishRosTopic?.('/telemetry', { velocity: Math.sin(index / 10) });
  });
  await pressXrControl(page, 'xr-series', 'settings');
  await pressXrControl(page, 'xr-series', 'row-2');
  await pressXrControl(page, 'xr-series', 'row-0:inc');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find(key =>
          key.startsWith('robo-boy-desktop-workspace-panels-v1:connection:')
        );
        return key ? JSON.parse(localStorage.getItem(key)!)[0].panelState.values.config.timeWindowSec : null;
      })
    )
    .toBe(20);
  await saveXrPanelPreview(page, 'xr-series', '/tmp/robo-boy-xr-time-series.png');
  await page.evaluate(() => window.__xrSession.end());
  await expect(page.locator('.xr-canvas-host canvas')).toHaveCount(0);
  await page.evaluate(() => window.__publishRosTopic?.('/telemetry', { velocity: 42 }));
  await expect(page.locator('.timeseries-legend')).toContainText('42 m/s');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Time window (seconds)')).toHaveValue('20');
  expect(await getActiveRosSubscriptionCount(page, '/telemetry')).toBe(1);
  expect(errors).toEqual([]);
});
