import { expect, test, type CDPSession, type Page } from '@playwright/test';

import {
  getActiveRosSubscriptionCount,
  getRosSubscriptionCount,
  installRosMock,
  waitForRosSubscription,
} from './helpers/rosMock';

const profileDescribe = process.env.ROBOBOY_PROFILE === '1' ? test.describe : test.describe.skip;
const SAMPLE_MS = Number(process.env.ROBOBOY_PROFILE_SAMPLE_MS || 5_000);
const PRIMITIVE_URDF = `
  <robot name="profile_robot">
    <link name="base_link">
      <visual>
        <geometry><box size="0.4 0.3 0.2" /></geometry>
        <material><color rgba="0.2 0.6 1 1" /></material>
      </visual>
    </link>
  </robot>
`;

type RuntimeCounters = {
  animationFrameCallbacks: number;
  animationFrameRequests: number;
  activeAnimationFrames: number;
  intervalCallbacks: number;
  activeIntervals: number;
  webglDrawCalls: number;
};

type BrowserSnapshot = RuntimeCounters & {
  domElements: number;
  canvases: number;
  canvasPixels: number;
  images: number;
  videos: number;
  runningCssAnimations: number;
};

type CdpMetrics = Record<string, number>;

declare global {
  interface Window {
    __roboBoyProfile?: RuntimeCounters;
    __publishRosTopic?: (topic: string, message: unknown) => void;
  }
}

const installRuntimeCounters = async (page: Page) => {
  await page.addInitScript(() => {
    const counters: RuntimeCounters = {
      animationFrameCallbacks: 0,
      animationFrameRequests: 0,
      activeAnimationFrames: 0,
      intervalCallbacks: 0,
      activeIntervals: 0,
      webglDrawCalls: 0,
    };
    window.__roboBoyProfile = counters;

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const pendingFrames = new Set<number>();

    window.requestAnimationFrame = callback => {
      counters.animationFrameRequests += 1;
      let frameId = 0;
      frameId = nativeRequestAnimationFrame(timestamp => {
        pendingFrames.delete(frameId);
        counters.activeAnimationFrames = pendingFrames.size;
        counters.animationFrameCallbacks += 1;
        callback(timestamp);
      });
      pendingFrames.add(frameId);
      counters.activeAnimationFrames = pendingFrames.size;
      return frameId;
    };
    window.cancelAnimationFrame = frameId => {
      pendingFrames.delete(frameId);
      counters.activeAnimationFrames = pendingFrames.size;
      nativeCancelAnimationFrame(frameId);
    };

    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const activeIntervals = new Set<number>();
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const intervalId = nativeSetInterval(
        (...callbackArgs: unknown[]) => {
          counters.intervalCallbacks += 1;
          if (typeof handler === 'function') handler(...callbackArgs);
        },
        timeout,
        ...args
      );
      activeIntervals.add(intervalId);
      counters.activeIntervals = activeIntervals.size;
      return intervalId;
    }) as typeof window.setInterval;
    window.clearInterval = intervalId => {
      activeIntervals.delete(intervalId);
      counters.activeIntervals = activeIntervals.size;
      nativeClearInterval(intervalId);
    };

    const instrumentWebGl = (constructorName: 'WebGLRenderingContext' | 'WebGL2RenderingContext') => {
      const constructor = window[constructorName] as typeof WebGLRenderingContext | undefined;
      if (!constructor) return;
      for (const methodName of ['drawArrays', 'drawElements'] as const) {
        const prototype = constructor.prototype as WebGLRenderingContext;
        const nativeMethod = prototype[methodName] as (...args: unknown[]) => unknown;
        if (typeof nativeMethod !== 'function') continue;
        Object.defineProperty(prototype, methodName, {
          configurable: true,
          value: function (...args: unknown[]) {
            counters.webglDrawCalls += 1;
            return nativeMethod.apply(this, args);
          },
        });
      }
    };
    instrumentWebGl('WebGLRenderingContext');
    instrumentWebGl('WebGL2RenderingContext');
  });
};

const getCdpMetrics = async (cdp: CDPSession): Promise<CdpMetrics> => {
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]));
};

const getBrowserSnapshot = async (page: Page): Promise<BrowserSnapshot> =>
  page.evaluate(() => {
    const counters = window.__roboBoyProfile!;
    const canvases = [...document.querySelectorAll('canvas')];
    return {
      ...counters,
      domElements: document.querySelectorAll('*').length,
      canvases: canvases.length,
      canvasPixels: canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0),
      images: document.images.length,
      videos: document.querySelectorAll('video').length,
      runningCssAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length,
    };
  });

const measure = async (page: Page, label: string, during?: () => Promise<void>) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);

  const beforeBrowser = await getBrowserSnapshot(page);
  const beforeCdp = await getCdpMetrics(cdp);
  const start = performance.now();
  if (during) await during();
  else await page.waitForTimeout(SAMPLE_MS);
  const elapsedSeconds = (performance.now() - start) / 1_000;
  const afterBrowser = await getBrowserSnapshot(page);
  const afterCdp = await getCdpMetrics(cdp);

  const result = {
    label,
    sampleSeconds: Number(elapsedSeconds.toFixed(3)),
    rendererMainThreadPercent: Number(
      ((((afterCdp.TaskDuration || 0) - (beforeCdp.TaskDuration || 0)) / elapsedSeconds) * 100).toFixed(2)
    ),
    scriptPercent: Number(
      ((((afterCdp.ScriptDuration || 0) - (beforeCdp.ScriptDuration || 0)) / elapsedSeconds) * 100).toFixed(2)
    ),
    animationFrameCallbacksPerSecond: Number(
      ((afterBrowser.animationFrameCallbacks - beforeBrowser.animationFrameCallbacks) / elapsedSeconds).toFixed(2)
    ),
    webglDrawCallsPerSecond: Number(
      ((afterBrowser.webglDrawCalls - beforeBrowser.webglDrawCalls) / elapsedSeconds).toFixed(2)
    ),
    intervalCallbacksPerSecond: Number(
      ((afterBrowser.intervalCallbacks - beforeBrowser.intervalCallbacks) / elapsedSeconds).toFixed(2)
    ),
    activeAnimationFrames: afterBrowser.activeAnimationFrames,
    activeIntervals: afterBrowser.activeIntervals,
    jsHeapMiB: Number(((afterCdp.JSHeapUsedSize || 0) / 1024 / 1024).toFixed(2)),
    domElements: afterBrowser.domElements,
    canvases: afterBrowser.canvases,
    canvasPixels: afterBrowser.canvasPixels,
    images: afterBrowser.images,
    videos: afterBrowser.videos,
    runningCssAnimations: afterBrowser.runningCssAnimations,
    layouts: (afterCdp.LayoutCount || 0) - (beforeCdp.LayoutCount || 0),
    styleRecalculations: (afterCdp.RecalcStyleCount || 0) - (beforeCdp.RecalcStyleCount || 0),
  };

  console.log(`ROBOBOY_PERF ${JSON.stringify(result)}`);
  await cdp.detach();
  return result;
};

const connect = async (page: Page) => {
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
};

const addPanel = async (page: Page, name: string) => {
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name, exact: true }).click();
};

const publishTfForSample = (page: Page, parentFrame = 'map') =>
  page.evaluate(async ({ sampleMs, parentFrame }) => {
    const startedAt = performance.now();
    let sequence = 0;
    await new Promise<void>(resolve => {
      const interval = window.setInterval(() => {
        sequence += 1;
        window.__publishRosTopic?.('/tf', {
          transforms: [
            {
              header: { frame_id: parentFrame, stamp: { sec: sequence, nanosec: 0 } },
              child_frame_id: 'base_link',
              transform: {
                translation: { x: sequence / 1_000, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 },
              },
            },
          ],
        });
        if (performance.now() - startedAt >= sampleMs) {
          window.clearInterval(interval);
          resolve();
        }
      }, 25);
    });
  }, { sampleMs: SAMPLE_MS, parentFrame });

const publishTfOnce = (page: Page, sequence = 1) =>
  page.evaluate(value => {
    window.__publishRosTopic?.('/tf', {
      transforms: [
        {
          header: { frame_id: 'odom', stamp: { sec: value, nanosec: 0 } },
          child_frame_id: 'base_link',
          transform: {
            translation: { x: value / 1_000, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
          },
        },
      ],
    });
  }, sequence);

const publishUrdfOnce = (page: Page) =>
  page.evaluate(urdf => {
    window.__publishRosTopic?.('/robot_description', { data: urdf });
  }, PRIMITIVE_URDF);

const orbitForSample = async (page: Page) => {
  const canvas = page.locator('.visualization-panel canvas').first();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3D canvas has no visible bounds');

  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const startedAt = performance.now();
  let direction = 1;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  while (performance.now() - startedAt < SAMPLE_MS) {
    await page.mouse.move(centerX + direction * 40, centerY + direction * 20, { steps: 2 });
    direction *= -1;
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
};

const publishPoseForSample = (page: Page) =>
  page.evaluate(async sampleMs => {
    const startedAt = performance.now();
    let sequence = 0;
    await new Promise<void>(resolve => {
      const interval = window.setInterval(() => {
        sequence += 1;
        window.__publishRosTopic?.('/pose', {
          header: { frame_id: 'odom', stamp: { sec: sequence, nanosec: 0 } },
          pose: {
            position: { x: sequence / 100, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        });
        if (performance.now() - startedAt >= sampleMs) {
          window.clearInterval(interval);
          resolve();
        }
      }, 25);
    });
  }, SAMPLE_MS);

const publishLaserScanForSample = (page: Page) =>
  page.evaluate(async sampleMs => {
    const startedAt = performance.now();
    await new Promise<void>(resolve => {
      const interval = window.setInterval(() => {
        window.__publishRosTopic?.('/scan', {
          header: { frame_id: 'odom', stamp: { sec: 1, nanosec: 0 } },
          angle_min: -Math.PI,
          angle_max: Math.PI,
          angle_increment: (2 * Math.PI) / 360,
          range_min: 0.1,
          range_max: 10,
          ranges: Array.from({ length: 360 }, () => 2),
          intensities: [],
        });
        if (performance.now() - startedAt >= sampleMs) {
          window.clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }, SAMPLE_MS);

profileDescribe('frontend resource profile', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Resource metrics require Chromium CDP.');
  test.beforeEach(async ({ page }) => {
    await installRuntimeCounters(page);
  });

  test('entry screen idle', async ({ page }) => {
    await page.goto('/');
    await measure(page, 'entry-idle');
  });

  test('connected empty workspace idle', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    await measure(page, 'connected-empty-idle');
  });

  test('single empty 3D panel idle', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await measure(page, '3d-empty-idle');
    await measure(page, '3d-tf-40hz-no-displayed-frames', () => publishTfForSample(page));

    const interaction = await measure(page, '3d-orbit-active', () => orbitForSample(page));
    expect(interaction.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.waitForTimeout(100);
    const settled = await measure(page, '3d-after-orbit-idle');
    expect(settled.webglDrawCallsPerSecond).toBe(0);
  });

  test('two empty 3D panels idle', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    await addPanel(page, '3D panel');
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(2);
    await waitForRosSubscription(page, '/tf');
    await waitForRosSubscription(page, '/tf_static');

    expect(await getRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getRosSubscriptionCount(page, '/tf_static')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf_static')).toBe(1);
    await measure(page, '3d-empty-two-panels-idle');

    await page.getByRole('button', { name: 'Remove 3D view', exact: true }).first().click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf')).toBe(1);
    expect(await getActiveRosSubscriptionCount(page, '/tf_static')).toBe(1);

    await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(0);
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/tf')).toBe(0);
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/tf_static')).toBe(0);
  });

  test('displayed TF frame when updates stop', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await waitForRosSubscription(page, '/tf');
    await publishTfOnce(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('checkbox', { name: 'base_link', exact: true }).check();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.waitForTimeout(100);
    const initialIdle = await measure(page, '3d-tf-displayed-static-idle');
    expect(initialIdle.webglDrawCallsPerSecond).toBe(0);
    const active = await measure(page, '3d-tf-displayed-40hz', () => publishTfForSample(page, 'odom'));
    expect(active.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.waitForTimeout(100);
    const settled = await measure(page, '3d-tf-displayed-after-updates-idle');
    expect(settled.webglDrawCallsPerSecond).toBe(0);
  });

  test('URDF follows TF updates and settles', async ({ page }) => {
    await installRosMock(page, {
      topics: [{ name: '/robot_description', type: 'std_msgs/msg/String' }],
    });
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await waitForRosSubscription(page, '/tf');

    // TF arrives before the URDF visualizer mounts. The provider snapshot must still initialize
    // the link immediately when the visualizer subscribes.
    await publishTfOnce(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: /Visualizations/ }).click();
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByRole('button', { name: /URDF/ }).click();
    await waitForRosSubscription(page, '/robot_description');

    const loaded = await measure(page, '3d-urdf-load-with-existing-tf', async () => {
      await publishUrdfOnce(page);
      await page.waitForTimeout(100);
    });
    expect(loaded.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();

    const active = await measure(page, '3d-urdf-tf-40hz', () => publishTfForSample(page, 'odom'));
    expect(active.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.waitForTimeout(100);
    const settled = await measure(page, '3d-urdf-after-tf-idle');
    expect(settled.webglDrawCallsPerSecond).toBe(0);
  });

  test('3D panel mount and unmount lifecycle', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    // Warm the lazy-loaded 3D bundle before comparing heap snapshots.
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(0);
    const before = await measure(page, '3d-lifecycle-before');

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await addPanel(page, '3D panel');
      await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
      await page.getByRole('button', { name: 'Remove 3D view', exact: true }).click();
      await expect(page.locator('.visualization-panel canvas')).toHaveCount(0);
    }

    const after = await measure(page, '3d-lifecycle-after-5-cycles');
    expect(after.canvases).toBe(0);
    expect(after.activeAnimationFrames).toBe(0);
    expect(after.domElements).toBe(before.domElements);
    expect(after.jsHeapMiB - before.jsHeapMiB).toBeLessThan(5);
  });

  test('TF tree idle and 40 Hz updates', async ({ page }) => {
    await installRosMock(page);
    await connect(page);
    await addPanel(page, 'TF tree');
    await expect(page.getByTestId('tf-tree-panel')).toBeVisible();
    await measure(page, 'tf-tree-idle');
    await measure(page, 'tf-tree-40hz', () => publishTfForSample(page));
  });

  test('camera panel without stream decode', async ({ page }) => {
    await page.route('**/video_stream*', route =>
      route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'),
      })
    );
    await installRosMock(page, { topics: [{ name: '/camera/image_raw', type: 'sensor_msgs/Image' }] });
    await connect(page);
    await addPanel(page, 'Camera');
    await expect(page.locator('.camera-view')).toHaveCount(1);
    await measure(page, 'camera-static-idle');
  });

  test('PoseStamped visualization active and settled', async ({ page }) => {
    await installRosMock(page, { topics: [{ name: '/pose', type: 'geometry_msgs/msg/PoseStamped' }] });
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: /Visualizations/ }).click();
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByRole('button', { name: /PoseStamped/ }).click();
    await waitForRosSubscription(page, '/pose');

    const active = await measure(page, '3d-posestamped-40hz', () => publishPoseForSample(page));
    expect(active.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.waitForTimeout(100);
    const settled = await measure(page, '3d-after-posestamped-idle');
    expect(settled.webglDrawCallsPerSecond).toBe(0);
  });

  test('LaserScan visualization idle, active, and settled', async ({ page }) => {
    await installRosMock(page, { topics: [{ name: '/scan', type: 'sensor_msgs/msg/LaserScan' }] });
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: /Visualizations/ }).click();
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByRole('button', { name: /LaserScan/ }).click();
    await waitForRosSubscription(page, '/scan');

    const idle = await measure(page, '3d-laserscan-before-data-idle');
    expect(idle.webglDrawCallsPerSecond).toBe(0);
    const active = await measure(page, '3d-laserscan-20hz', () => publishLaserScanForSample(page));
    expect(active.webglDrawCallsPerSecond).toBeGreaterThan(1);
    await page.waitForTimeout(100);
    const settled = await measure(page, '3d-after-laserscan-idle');
    expect(settled.webglDrawCallsPerSecond).toBe(0);
  });

  test('restored 3D visualization after connection-session switch', async ({ page }) => {
    await installRosMock(page, { topics: [{ name: '/scan', type: 'sensor_msgs/msg/LaserScan' }] });
    await connect(page);
    await addPanel(page, '3D panel');
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: /Visualizations/ }).click();
    await page.getByRole('button', { name: 'Add visualization', exact: true }).click();
    await page.getByRole('button', { name: /LaserScan/ }).click();
    await waitForRosSubscription(page, '/scan');
    const subscriptionCount = await page.evaluate(() =>
      (window as unknown as { __getRosSubscriptionCount: (topic: string) => number })
        .__getRosSubscriptionCount('/scan')
    );

    await page.getByRole('button', { name: /Switch connections, current/ }).click();
    await page.getByRole('button', { name: 'Open another connection', exact: true }).click();
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.2');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();

    await page.getByRole('button', { name: /Switch connections, current/ }).click();
    await page.getByRole('button', { name: /^127\.0\.0\.1; ROS .*Connected/ }).click();
    await expect(page.locator('.visualization-panel canvas')).toHaveCount(1);
    await waitForRosSubscription(page, '/scan', subscriptionCount);
    const resumed = await measure(page, '3d-after-session-switch-idle');
    expect(resumed.webglDrawCallsPerSecond).toBe(0);
  });
});
