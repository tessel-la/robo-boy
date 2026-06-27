import { expect, test, type Page } from '@playwright/test';

import { installRosMock } from './helpers/rosMock';

const transform = (parent: string, child: string, sec: number) => ({
  header: { frame_id: parent, stamp: { sec, nanosec: 0 } },
  child_frame_id: child,
  transform: {
    translation: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
});

async function publishTf(page: Page, topic: '/tf' | '/tf_static', transforms: unknown[]) {
  await page.evaluate(
    ({ topicName, payload }) => {
      (
        window as unknown as {
          __publishRosTopic: (topic: string, message: unknown) => void;
        }
      ).__publishRosTopic(topicName, { transforms: payload });
    },
    { topicName: topic, payload: transforms }
  );
}

test('visualizes live, static, and disconnected TF trees', async ({ page }) => {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Switch to TF Tree').click();
  await expect(page.getByTestId('tf-tree-panel')).toBeVisible();

  await publishTf(page, '/tf', [transform('map', 'base_link', 100), transform('base_link', 'laser', 101)]);
  await publishTf(page, '/tf_static', [transform('world', 'camera_mount', 1)]);

  await page.getByTestId('tf-tree-menu-button').click();
  const summary = page.getByLabel('TF graph summary');
  await expect(summary).toContainText('5 frames');
  await expect(summary).toContainText('3 transforms');
  await expect(summary).toContainText('2 trees');
  await expect(page.locator('.tf-transform-edge--static')).toHaveCount(1);
  await page.getByLabel('Close TF tree menu').click();

  for (const theme of ['light', 'dark', 'solarized']) {
    await page.evaluate(themeName => {
      if (themeName === 'light') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', themeName);
    }, theme);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const resolveColor = (variable: string) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${variable})`;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          };
          const panel = document.querySelector<HTMLElement>('.tf-tree-panel');
          const healthy = document.querySelector<HTMLElement>('.tf-frame-node--healthy');
          const staticNode = document.querySelector<HTMLElement>('.tf-frame-node--static');
          if (!panel || !healthy || !staticNode) return false;
          return (
            getComputedStyle(panel).backgroundColor === resolveColor('--background-color') &&
            getComputedStyle(healthy).borderTopColor === resolveColor('--primary-color') &&
            getComputedStyle(staticNode).borderTopColor === resolveColor('--secondary-color')
          );
        })
      )
      .toBe(true);
  }

  await page.getByLabel('Search TF frame').fill('laser');
  await page.getByLabel('Search TF frame').press('Enter');
  await expect(page.locator('.tf-frame-node--match')).toHaveCount(1);

  await page.getByLabel('Pause live TF updates').click();
  await publishTf(page, '/tf', [transform('base_link', 'imu', 102)]);
  await page.getByTestId('tf-tree-menu-button').click();
  await expect(summary).toContainText('5 frames');
  await page.getByLabel('Close TF tree menu').click();
  await page.getByLabel('Resume live TF updates').click();
  await page.getByTestId('tf-tree-menu-button').click();
  await expect(summary).toContainText('6 frames');

  await page.getByLabel('Static TF').uncheck();
  await expect(summary).toContainText('4 frames');
  await page.getByLabel('Close TF tree menu').click();
  await page.getByLabel('Fit TF graph to view').click();
});

test('adapts TF controls to a narrow desktop workspace tile', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.addInitScript(() => {
    localStorage.setItem('robo-boy-desktop-workspace-open-v1', 'true');
    localStorage.setItem(
      'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([
        { id: 'tf-panel', type: 'tfTree', title: 'TF tree' },
        { id: 'bt-panel', type: 'behaviorTree', title: 'Behavior tree' },
      ])
    );
    localStorage.setItem(
      'robo-boy-desktop-workspace-tile-order-v1',
      JSON.stringify(['base-view', 'base-pads', 'tf-panel', 'bt-panel'])
    );
    localStorage.setItem(
      'robo-boy-desktop-workspace-layout-v1',
      JSON.stringify({
        rowSizes: [1, 3],
        rowRatios: [1, 1],
        columnRatiosByRow: { 0: [1], 1: [1, 1, 1] },
      })
    );
  });
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  const panel = page.getByTestId('tf-tree-panel');
  await expect(panel).toBeVisible();
  await publishTf(page, '/tf', [transform('map', 'base_link', 100)]);

  await expect
    .poll(async () => {
      const panelBox = await panel.boundingBox();
      const searchBox = await page.getByTestId('tf-tree-search').boundingBox();
      const pauseBox = await page.getByLabel('Pause live TF updates').boundingBox();
      if (!panelBox || !searchBox || !pauseBox) return false;
      return (
        panelBox.width < 500 &&
        searchBox.width <= 44 &&
        pauseBox.width >= 42 &&
        searchBox.x + searchBox.width <= panelBox.x + panelBox.width &&
        pauseBox.x + pauseBox.width <= panelBox.x + panelBox.width
      );
    })
    .toBe(true);

  await page.getByTestId('tf-tree-menu-button').click();
  const menuBox = await page.getByTestId('tf-tree-menu-panel').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(
    menuBox && panelBox && menuBox.x >= panelBox.x && menuBox.x + menuBox.width <= panelBox.x + panelBox.width
  ).toBe(true);
});

test('keeps the TF tree controls, graph, and details usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.getByLabel('Switch to TF Tree').click();

  const panel = page.getByTestId('tf-tree-panel');
  const canvas = page.getByTestId('tf-tree-canvas');
  const details = page.getByLabel('TF selection details');

  await expect(panel).toBeVisible();
  await publishTf(page, '/tf', [transform('map', 'base_link', 100), transform('base_link', 'laser', 101)]);
  await publishTf(page, '/tf_static', [transform('world', 'camera_mount', 1)]);

  await expect(page.getByLabel('Pause live TF updates')).toBeVisible();
  await expect(page.getByLabel('Fit TF graph to view')).toBeVisible();
  await expect(page.getByLabel('Search TF frame')).toBeVisible();
  await page.getByTestId('tf-tree-menu-button').click();
  await expect(page.getByLabel('Filter TF frames')).toBeVisible();
  await expect(page.getByTestId('tf-tree-menu-panel')).toBeVisible();
  await page.getByLabel('Close TF tree menu').click();
  await expect(details).toHaveCount(0);

  const laserNode = page.locator('.tf-frame-node').filter({ hasText: 'laser' });
  await expect(laserNode).toBeVisible();
  await laserNode.click();
  await expect(details).toBeVisible();
  await expect(details).toContainText('laser');

  await expect
    .poll(async () => {
      const panelBox = await panel.boundingBox();
      const canvasBox = await canvas.boundingBox();
      const detailsBox = await details.boundingBox();
      if (!panelBox || !canvasBox || !detailsBox) return false;

      return (
        panelBox.x >= 0 &&
        panelBox.x + panelBox.width <= 390 &&
        canvasBox.height > 220 &&
        detailsBox.height > 90 &&
        detailsBox.y > canvasBox.y
      );
    })
    .toBe(true);
});
