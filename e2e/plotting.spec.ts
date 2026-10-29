import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installRosMock, publishRosMessage, getActiveRosSubscriptionCount } from './helpers/rosMock';

async function setup(page: Page, theme = 'dark') {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.addInitScript(theme => {
    localStorage.setItem('appTheme', theme);
    if (theme === 'custom-cobalt')
      localStorage.setItem(
        'customThemes',
        JSON.stringify([
          {
            id: theme,
            name: 'Cobalt',
            fontFamily: "Georgia, 'Times New Roman', serif",
            colors: {
              primary: '#ff9c70',
              secondary: '#77c8ff',
              background: '#112866',
              text: '#f5efd9',
              border: '#657cb7',
              cardBg: '#19316a',
              buttonText: '#14234a',
            },
          },
        ])
      );
    if (localStorage.getItem('plotting-seeded')) return;
    localStorage.setItem('plotting-seeded', 'true');
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([
        {
          id: 'plot',
          type: 'timeSeries',
          title: 'Saved signals',
          panelState: {
            schemaVersion: 1,
            panelId: 'timeSeries',
            values: {
              config: {
                schemaVersion: 4,
                throttleMs: 0,
                series: [
                  {
                    id: 'x',
                    topic: '/pose',
                    messageType: 'example/Pose',
                    fieldPath: 'x',
                    label: 'Position X',
                    unit: 'm',
                  },
                  {
                    id: 'y',
                    topic: '/pose',
                    messageType: 'example/Pose',
                    fieldPath: 'y',
                    label: 'Position Y',
                    unit: 'm',
                  },
                ],
              },
            },
          },
        },
      ])
    );
    localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['plot']));
  }, theme);
  await installRosMock(page, { topics: [{ name: '/pose', type: 'example/Pose' }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Plotting', exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/pose')).toBe(1);
  return panel;
}

test('migrates the existing panel to Plotting, shares XY sources, exports paired samples and restores its mode', async ({
  page,
}) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await expect(panel.getByLabel('Plot mode')).toHaveValue('time');
  await panel.getByLabel('Plot mode').selectOption('xy');
  await panel.getByLabel('X signal', { exact: true }).selectOption('x');
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  for (let x = 1; x <= 3; x++) await publishRosMessage(page, '/pose', { x, y: x * 2 });
  await expect(panel).toContainText('3 samples');
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/pose')).toBe(1);
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain('series,time_ms,x,y');
  expect(csv).toContain(',1,2');
  expect(csv).toContain(',3,6');
  await page.reload();
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await expect(panel.getByLabel('Plot mode')).toHaveValue('xy');
  await expect(panel.getByLabel('X signal', { exact: true })).toHaveValue('x');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByLabel('XY pairing').selectOption('latest');
  await panel.getByLabel('Maximum X age (ms)').fill('50');
  await panel.getByLabel('Maximum X age (ms)').blur();
  await panel.getByLabel('XY display').selectOption('scatter');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await publishRosMessage(page, '/pose', { x: 4, y: 8 });
  await expect(panel).toContainText('1 samples');
});

for (const theme of ['dark', 'light', 'solarized', 'custom-cobalt'])
  test(`interval analysis and XY controls fit a narrow tile in ${theme}`, async ({ page }, testInfo) => {
    const panel = await setup(page, theme);
    for (let x = 1; x <= 3; x++) await publishRosMessage(page, '/pose', { x, y: x * 2 });
    await expect(panel).toContainText('6 samples');
    await panel.evaluate(element => {
      element.style.width = '370px';
      element.style.maxWidth = '100%';
    });
    await panel.getByRole('button', { name: 'More', exact: true }).click();
    await panel.getByRole('button', { name: 'Interval statistics', exact: true }).click();
    const analysis = panel.getByRole('region', { name: 'Interval statistics' });
    await expect(analysis).toBeVisible();
    await expect(analysis.getByRole('row', { name: /^Position Y/ })).toContainText('4');
    await publishRosMessage(page, '/pose', { x: 100, y: 200 });
    await expect(analysis.getByRole('row', { name: /^Position Y/ })).not.toContainText('200');
    expect(await analysis.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`plotting-${theme}.png`) });
    await analysis.getByRole('button', { name: 'Close interval statistics' }).click();
    await panel.getByRole('button', { name: 'More', exact: true }).click();
    await panel.getByLabel('Plot mode').selectOption('xy');
    await panel.getByLabel('X signal', { exact: true }).selectOption('x');
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'XY settings' })).toBeVisible();
    await panel.getByRole('region', { name: 'XY settings' }).scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`plotting-settings-${theme}.png`) });
  });
