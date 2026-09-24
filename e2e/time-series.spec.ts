import { expect, test, type Page } from '@playwright/test';
import { getActiveRosSubscriptionCount, getRosSubscriptionCount, installRosMock } from './helpers/rosMock';
const longTopic = '/robot/' + 'very_long_joint_telemetry_namespace_'.repeat(5) + '/state';
async function connect(page: Page) {
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}
async function publish(page: Page, topic: string, message: unknown) {
  await page.evaluate(
    ({ topic, message }) =>
      (window as unknown as { __publishRosTopic: (t: string, m: unknown) => void }).__publishRosTopic(topic, message),
    { topic, message }
  );
}
async function seed(page: Page, mobile = false, signalCount = 2) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1200, height: 820 });
  await page.addInitScript(
    ({ topic, signalCount }) => {
      if (localStorage.getItem('time-series-seeded')) return;
      localStorage.setItem('time-series-seeded', 'true');
      const type = 'la.tessel.roboboy.timeseries';
      localStorage.setItem(
        'robo-boy-desktop-workspace-panels-v1',
        JSON.stringify([
          {
            id: 'time-series-test',
            type,
            title: 'ROS Time Series',
            panelState: {
              schemaVersion: 1,
              panelId: type,
              values: {
                config: {
                  schemaVersion: 3,
                  series: [
                    ...Array.from({ length: signalCount - 2 }, (_, index) => ({
                      id: `extra-${index}`,
                      topic,
                      messageType: 'Test',
                      fieldPath: 'value',
                      label: `Joint ${index + 1}`,
                    })),
                    {
                      id: 'a',
                      topic,
                      messageType: 'Test',
                      fieldPath: 'value',
                      label: 'Position',
                      color: '#57d68d',
                      unit: 'm',
                      filter: { type: 'ema', alpha: 0.5 },
                    },
                    {
                      id: 'b',
                      topic: '/reference',
                      messageType: 'Test',
                      fieldPath: 'value',
                      label: 'Reference',
                      enabled: false,
                    },
                  ],
                  timeWindowSec: 15,
                  sampleLimit: 100,
                  throttleMs: 0,
                  renderFps: 20,
                },
              },
            },
          },
        ])
      );
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['time-series-test']));
    },
    { topic: longTopic, signalCount }
  );
  await installRosMock(page, {
    topics: [
      { name: longTopic, type: 'Test' },
      { name: '/reference', type: 'Test' },
    ],
  });
  await connect(page);
}

test('migrates saved external tiles, plots multiple topics, derives signals and restores settings', async ({
  page,
}) => {
  await seed(page);
  const panel = page.getByRole('region', { name: 'Time Series', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator('iframe')).toHaveCount(0);
  await expect.poll(() => getActiveRosSubscriptionCount(page, longTopic)).toBe(1);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/reference')).toBe(0);
  await publish(page, longTopic, { value: 2 });
  await expect(panel.locator('.timeseries-legend')).toContainText('2 m');
  await panel.getByRole('button', { name: /Reference/ }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/reference')).toBe(1);
  await publish(page, '/reference', { value: 4 });
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  const position = panel.getByRole('region', { name: 'Position', exact: true });
  await position.getByText('Math and derived signal', { exact: true }).click();
  await position.getByRole('button', { name: 'Duplicate as derived signal' }).click();
  const derived = panel.getByRole('region', { name: 'Position derived', exact: true });
  await derived.getByText('Math and derived signal', { exact: true }).click();
  await derived.getByLabel('Expression', { exact: true }).fill('x - y');
  await derived.getByLabel('Secondary signal (y)').selectOption('b');
  await derived.getByLabel('Smoothing').selectOption('raw');
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await publish(page, longTopic, { value: 10 });
  await expect(panel.locator('.timeseries-legend').getByRole('button', { name: /Position derived/ })).toContainText(
    '6 m'
  );
  await expect.poll(() => getActiveRosSubscriptionCount(page, longTopic)).toBe(1);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await publish(page, longTopic, { value: 20 });
  await expect(panel.locator('.timeseries-legend').getByRole('button', { name: /Position derived/ })).toContainText(
    '6 m'
  );
  const downloadEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await panel.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toContain('timeseries');
  await page.reload();
  // Entry requires connecting again; persisted sessions may reconnect automatically.
  if (await page.getByTitle('Advanced Options').isVisible()) {
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
  }
  await expect(panel.locator('.timeseries-legend').getByRole('button', { name: /Position derived/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await derived.getByText('Math and derived signal', { exact: true }).click();
  await expect(derived.getByLabel('Expression', { exact: true })).toHaveValue('x - y');
});

test('rectangle zoom, wheel, pan, keyboard reset and clear work on the native canvas', async ({ page }) => {
  await seed(page);
  const panel = page.locator('.timeseries-panel'),
    canvas = panel.locator('canvas');
  for (let i = 0; i < 12; i++) {
    await publish(page, longTopic, { value: i });
    await page.waitForTimeout(15);
  }
  const range = panel.getByLabel('Visible plot range');
  await expect(range).toContainText('Window 15.00s');
  await expect(panel.locator('.timeseries-legend').getByRole('button', { name: /^Position/ })).not.toContainText('—');
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 90, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7, { steps: 10 });
  await page.mouse.up();
  await expect(range).not.toContainText('Window 15.00s');
  const selected = await range.textContent();
  await publish(page, longTopic, { value: 500 });
  await expect(range).toHaveText(selected!);
  await page.mouse.wheel(0, -120);
  await expect(range).not.toHaveText(selected!);
  await panel.getByRole('button', { name: 'Reset / Live' }).click();
  await expect(range).toContainText('Window 15.00s');
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await panel.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(range).toContainText('Window 10.00s');
  const beforePan = await range.textContent();
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await panel.getByRole('button', { name: 'Pan', exact: true }).click();
  await page.mouse.move(bounds.x + 120, bounds.y + 90);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 160, bounds.y + 130);
  await page.mouse.up();
  await expect(range).not.toHaveText(beforePan!);
  await expect(range).toContainText('Window 10.00s');
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(range).toContainText('Window 15.00s');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByText('Plot and performance', { exact: true }).click();
  await panel.getByLabel('Auto Y range').uncheck();
  await panel.getByLabel('Y minimum', { exact: true }).fill('-100');
  await panel.getByLabel('Y minimum', { exact: true }).press('Tab');
  await panel.getByLabel('Y maximum', { exact: true }).fill('100');
  await panel.getByLabel('Y maximum', { exact: true }).press('Tab');
  await panel.getByLabel('Point markers').check();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(range).toContainText('Y -100 to 100');
  for (const theme of ['light', 'dark', 'solarized']) {
    await page.evaluate(theme => {
      if (theme === 'light') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
    }, theme);
    await expect
      .poll(() =>
        panel.evaluate(el => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--background-color)';
          el.appendChild(probe);
          const matches = getComputedStyle(probe).backgroundColor === getComputedStyle(el).backgroundColor;
          probe.remove();
          return matches;
        })
      )
      .toBe(true);
  }
  await page.screenshot({ path: '/tmp/roboboy-timeseries-desktop.png' });
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await panel.getByRole('button', { name: 'Clear data', exact: true }).click();
  await expect(panel.locator('.timeseries-footer')).toContainText('0 samples');
});

test('mobile settings contain long names and touch selection/pinch preserve a usable plot', async ({ page }) => {
  await seed(page, true);
  const panel = page.locator('.timeseries-panel');
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() =>
        panel.evaluate(el => {
          const panel = el.getBoundingClientRect();
          const plot = el.querySelector('canvas')!.getBoundingClientRect();
          return plot.height / panel.height;
        })
      )
      .toBeGreaterThan(0.75);
    await expect
      .poll(() => panel.locator('.timeseries-legend').evaluate(el => el.getBoundingClientRect().height))
      .toBeLessThanOrEqual(52);
    await expect
      .poll(() =>
        panel.evaluate(
          el =>
            el.querySelector('.timeseries-toolbar')!.getBoundingClientRect().left -
            el.querySelector('.timeseries-header')!.getBoundingClientRect().right
        )
      )
      .toBeGreaterThanOrEqual(0);
  }
  const primary = panel.locator('.timeseries-toolbar > button, .timeseries-more > button');
  expect(
    await primary.evaluateAll(buttons =>
      buttons.every(button => {
        const r = button.getBoundingClientRect();
        return r.width >= 40 && r.height >= 40;
      })
    )
  ).toBe(true);
  expect(
    await primary.evaluateAll(
      buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size
    )
  ).toBe(1);
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Reset / Live', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await expect(panel.getByRole('group', { name: 'More plot controls' })).toBeVisible();
  await panel.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  await expect(panel.getByRole('group', { name: 'More plot controls' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'More', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'More', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await panel.getByRole('button', { name: 'Reset / Live', exact: true }).click();

  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByText('Label, unit and source', { exact: true }).first().click();
  await panel
    .getByRole('region', { name: 'Position', exact: true })
    .getByLabel('Label', { exact: true })
    .fill(longTopic);
  await panel.getByText('Math and derived signal', { exact: true }).first().click();
  await expect
    .poll(() => panel.locator('.timeseries-settings').evaluate(el => el.scrollWidth <= el.clientWidth))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/roboboy-timeseries-mobile-settings.png' });
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await publish(page, longTopic, { value: 2 });
  const canvas = panel.locator('canvas'),
    r = (await canvas.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + 70, y: r.y + 30 }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: r.x + r.width - 25, y: r.y + r.height - 40 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const range = panel.getByLabel('Visible plot range');
  await expect(range).not.toContainText('Window 15.00s');
  const selected = await range.textContent();
  const centerX = r.x + r.width / 2,
    centerY = r.y + r.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 20, y: centerY },
      { x: centerX + 20, y: centerY },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 60, y: centerY },
      { x: centerX + 60, y: centerY },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(range).not.toHaveText(selected!);
  await panel.getByRole('button', { name: 'Reset / Live' }).click();
  await page.screenshot({ path: '/tmp/roboboy-timeseries-mobile-plot.png' });
});

test('adds the native panel and discovers multiple numeric fields without external installation', async ({ page }) => {
  await installRosMock(page, { topics: [{ name: '/joint_states', type: 'JointState' }] });
  await connect(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Time Series', exact: true }).click();
  const panel = page.locator('.timeseries-panel');
  await panel.getByRole('button', { name: 'Add signals', exact: true }).click();
  await panel.getByRole('button', { name: '/joint_states JointState', exact: true }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/joint_states')).toBe(1);
  await publish(page, '/joint_states', {
    header: { stamp: { sec: 2, nanosec: 0 } },
    position: [1, 2],
    velocity: [3, 4],
  });
  await expect(panel.getByText('4 / 16 signals', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await panel.getByRole('button', { name: 'Switch signals', exact: true }).click();
  await expect(panel.locator('.timeseries-signal-list button')).toHaveCount(4);
  await expect(panel.locator('.timeseries-legend')).toContainText('position[0]');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByRole('button', { name: 'Remove /joint_states · velocity[1]', exact: true }).click();
  await panel.getByText('Plot and performance', { exact: true }).click();
  const subscriptions = await getRosSubscriptionCount(page, '/joint_states');
  await panel.getByLabel('Bridge throttle (ms)').fill('100');
  await panel.getByLabel('Bridge throttle (ms)').press('Tab');
  await expect.poll(() => getRosSubscriptionCount(page, '/joint_states')).toBeGreaterThan(subscriptions);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/joint_states')).toBe(1);
  await panel.getByLabel('Numeric field', { exact: true }).fill('position[7]');
  await panel.getByRole('button', { name: 'Add field', exact: true }).click();
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  await publish(page, '/joint_states', { position: [1, 2, 3, 4, 5, 6, 7, 8], velocity: [3, 4] });
  await panel.getByRole('button', { name: 'Switch signals', exact: true }).click();
  await expect(panel.locator('.timeseries-legend').getByRole('button', { name: /position\[7\]/ })).toContainText('8');
});

test('remains interactive with 16 topics at 200 Hz and caps both canvas work and history', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([
        {
          id: 'stress',
          type: 'timeSeries',
          title: 'Streaming telemetry',
          panelState: {
            schemaVersion: 1,
            panelId: 'timeSeries',
            values: {
              config: {
                schemaVersion: 4,
                sampleLimit: 200,
                throttleMs: 0,
                renderFps: 20,
                timeWindowSec: 2,
                series: Array.from({ length: 16 }, (_, i) => ({
                  id: String(i),
                  topic: `/stream${i}`,
                  messageType: 'T',
                  fieldPath: 'value',
                  label: `Joint ${i + 1}`,
                  filter: { type: 'ema', alpha: 0.2 },
                  math: { expression: 'x', scale: 1 + i / 16, offset: i },
                })),
              },
            },
          },
        },
      ])
    );
    localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', '["stress"]');
  });
  await installRosMock(page, { topics: Array.from({ length: 16 }, (_, i) => ({ name: `/stream${i}`, type: 'T' })) });
  await connect(page);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/stream15')).toBe(1);
  const workload = page.evaluate(async () => {
    const mock = window as unknown as { __publishRosTopic: (t: string, m: unknown) => void };
    let frames = 0,
      paints = 0,
      frame = 0,
      maxGap = 0,
      lastFrame = performance.now();
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.closest('.timeseries-panel')) paints++;
      return original.apply(this, args);
    };
    const watch = (now: number) => {
      frames++;
      maxGap = Math.max(maxGap, now - lastFrame);
      lastFrame = now;
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    const started = performance.now();
    await new Promise<void>(resolve => {
      let tick = 0;
      const timer = setInterval(() => {
        for (let i = 0; i < 16; i++) mock.__publishRosTopic(`/stream${i}`, { value: Math.sin(tick / 20 + i) });
        if (++tick === 800) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    cancelAnimationFrame(frame);
    CanvasRenderingContext2D.prototype.clearRect = original;
    return { frames, paints, maxGap, elapsed: performance.now() - started };
  });
  await page.waitForTimeout(500);
  const panel = page.locator('.timeseries-panel');
  const startClick = Date.now();
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(panel.getByLabel('Time series settings', { exact: true })).toBeVisible();
  expect(Date.now() - startClick).toBeLessThan(2000);
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  const result = await workload;
  expect(result.frames / (result.elapsed / 1000)).toBeGreaterThan(20);
  expect(result.paints).toBeLessThanOrEqual(Math.ceil((result.elapsed / 1000) * 21) + 3);
  await expect(panel.locator('.timeseries-footer')).toContainText('3,200 samples');
  await page.screenshot({ path: '/tmp/roboboy-timeseries-streaming.png' });
  console.log('Time Series browser workload:', result);
  await page.getByLabel('Remove Streaming telemetry', { exact: true }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/stream0')).toBe(0);
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/stream15')).toBe(0);
});

test('large legends stay compact and switch signals without closing or resizing the plot', async ({ page }) => {
  await seed(page, true, 16);
  const panel = page.locator('.timeseries-panel');
  const trigger = panel.getByRole('button', { name: 'Switch signals', exact: true });
  const picker = panel.getByRole('group', { name: 'Switch signals', exact: true });
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 1200, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(trigger).toHaveText('15 / 16 visible');
    const height = await panel.locator('canvas').evaluate(el => el.getBoundingClientRect().height);
    await trigger.click();
    await expect(picker).toBeFocused();
    await expect(picker).toBeVisible();
    expect(await panel.locator('canvas').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
      height
    );
    expect(
      await panel.locator('.timeseries-legend').evaluate(el => el.getBoundingClientRect().height)
    ).toBeLessThanOrEqual(52);
    expect(
      await picker.evaluate(el => {
        const r = el.getBoundingClientRect(),
          p = el.closest('.timeseries-panel')!.getBoundingClientRect();
        return (
          r.top >= p.top &&
          r.bottom <= p.bottom &&
          r.left >= p.left &&
          r.right <= p.right &&
          el.scrollWidth <= el.clientWidth
        );
      })
    ).toBe(true);
    const search = picker.getByRole('searchbox');
    await search.fill('reference');
    const reference = picker.getByRole('button', { name: 'Reference', exact: true });
    await reference.click();
    await expect(reference).toHaveAttribute('aria-pressed', 'true');
    await expect(trigger).toHaveText('16 / 16 visible');
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/reference')).toBe(1);
    await publish(page, '/reference', { value: 42 });
    await expect(reference).toContainText('42');
    await reference.click();
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/reference')).toBe(0);
    await search.fill('no such signal');
    await expect(picker.getByRole('status')).toContainText('No matching signals');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click();
  await expect(picker.getByRole('searchbox')).toHaveValue('');
  expect(await picker.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.screenshot({ path: '/tmp/roboboy-signal-switcher.png' });
  await panel.getByRole('button', { name: 'Close signal switcher' }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(picker).toHaveCount(0);
});
