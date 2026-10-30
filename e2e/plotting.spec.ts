import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installRosMock, publishRosMessage, getActiveRosSubscriptionCount } from './helpers/rosMock';

async function setup(page: Page, theme = 'dark', topic = '/pose') {
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.addInitScript(
    ({ theme, topic }) => {
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
                      topic,
                      messageType: 'example/Pose',
                      fieldPath: 'x',
                      label: topic === '/pose' ? 'Position X' : '',
                      unit: 'm',
                    },
                    {
                      id: 'y',
                      topic,
                      messageType: 'example/Pose',
                      fieldPath: 'y',
                      label: topic === '/pose' ? 'Position Y' : '',
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
    },
    { theme, topic }
  );
  await installRosMock(page, { topics: [{ name: topic, type: 'example/Pose' }] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Quick Connect 127.0.0.1', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Plotting', exact: true });
  await expect(panel).toBeVisible();
  await expect.poll(() => getActiveRosSubscriptionCount(page, topic)).toBe(1);
  return panel;
}

test('migrates the existing panel to Plotting, shares XY sources, exports paired samples and restores its mode', async ({
  page,
}) => {
  const panel = await setup(page);
  await expect(panel.getByRole('button', { name: 'Time series', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByRole('button', { name: 'XY plot', exact: true }).click();
  await panel.getByRole('button', { name: 'X signal', exact: true }).click();
  await panel
    .getByRole('group', { name: 'X signal choices' })
    .getByRole('button', { name: /^Position X/ })
    .click();
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
  await expect(panel.getByRole('button', { name: 'XY plot', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'X signal', exact: true })).toContainText('Position X');
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
    await panel.getByRole('button', { name: 'XY plot', exact: true }).click();
    await panel.getByRole('button', { name: 'X signal', exact: true }).click();
    await panel
      .getByRole('group', { name: 'X signal choices' })
      .getByRole('button', { name: /^Position X/ })
      .click();
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`compact-plot-${theme}.png`) });
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(panel.getByRole('region', { name: 'XY settings' })).toBeVisible();
    await panel.getByRole('region', { name: 'XY settings' }).scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath(`plotting-settings-${theme}.png`) });
  });

test('long ROS source names remain readable in the plot and settings at narrow widths', async ({ page }, testInfo) => {
  const topic = '/robot/' + 'very_long_joint_telemetry_namespace_'.repeat(5) + '/state';
  const panel = await setup(page, 'dark', topic);
  await panel.getByRole('button', { name: 'XY plot', exact: true }).click();
  for (const width of [320, 390, 900]) {
    await panel.evaluate((element, width) => {
      element.style.width = `${width}px`;
      element.style.maxWidth = '100%';
    }, width);
    const x = panel.getByRole('button', { name: 'X signal', exact: true });
    await x.click();
    const choices = panel.getByRole('group', { name: 'X signal choices' });
    await choices.getByRole('searchbox').fill('state · x');
    const option = choices.getByRole('button', { name: topic + ' · x (m)', exact: true });
    await expect(option).toBeVisible();
    await expect(option).toHaveCSS('white-space', 'normal');
    expect(
      await option.evaluate(
        element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
    await option.click();
    await expect(x).toContainText(topic);
    expect(
      await x.evaluate(
        element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByText('Add ROS topic', { exact: true }).click();
    const result = panel.locator('.timeseries-topic-list button').first();
    await expect(result).toContainText(topic);
    expect(
      await result.evaluate(
        element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1
      )
    ).toBe(true);
    await panel.getByRole('button', { name: 'Configured topic', exact: true }).click();
    const topics = panel.getByRole('group', { name: 'Configured topic choices' });
    await expect(topics.getByRole('button', { name: topic + ' example/Pose', exact: true })).toBeVisible();
    expect(await topics.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath(`long-sources-${width}.png`) });
    await topics.getByRole('searchbox').press('Escape');
    await expect(panel.getByLabel('Plotting settings', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Done', exact: true }).click();
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await panel.screenshot({ path: testInfo.outputPath('visible-plot-mode-and-x.png') });
});
