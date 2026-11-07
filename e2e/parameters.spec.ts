import { expect, test, type Page } from '@playwright/test';
import {
  getActiveRosSubscriptionCount,
  getRosServiceCalls,
  installRosMock,
  publishRosMessage,
} from './helpers/rosMock';

const descriptor = (name: string, type: number, read_only = false) => ({
  name,
  type,
  read_only,
  dynamic_typing: false,
  description: name === 'speed' ? 'Maximum driving speed' : 'Simulation clock',
  additional_constraints: '',
  integer_range: [],
  floating_point_range: name === 'speed' ? [{ from_value: 0, to_value: 5, step: 0 }] : [],
});
const services = ['list_parameters', 'get_parameters', 'describe_parameters', 'set_parameters_atomically'].map(
  (name, index) => ({
    name: `/controller/${name}`,
    type: `rcl_interfaces/srv/${['ListParameters', 'GetParameters', 'DescribeParameters', 'SetParametersAtomically'][index]}`,
  })
);
async function setup(page: Page, { mobile = false, observer = false } = {}) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 });
  await page.addInitScript(mobile => {
    if (localStorage.getItem('parameters-seeded')) return;
    localStorage.setItem('parameters-seeded', 'true');
    const panel = { id: 'parameters-test', type: 'dataExplorer', title: 'Data Explorer' };
    localStorage.setItem(
      mobile ? 'robo-boy-mobile-workspace-panels-v1' : 'robo-boy-desktop-workspace-panels-v1',
      JSON.stringify([panel])
    );
    if (!mobile) localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['parameters-test']));
  }, mobile);
  await installRosMock(page, {
    controlMode: observer ? 'observer' : 'owner',
    services,
    nodes: [{ name: '/controller', services: services.map(service => service.name) }],
    serviceCalls: {
      '/controller/list_parameters': [{ values: { result: { names: ['speed', 'use_sim_time'] } } }],
      '/controller/get_parameters': [1, 1, 1, 2].map(speed => ({
        values: {
          values: [
            { type: 3, double_value: speed },
            { type: 1, bool_value: false },
          ],
        },
      })),
      '/controller/describe_parameters': [
        { values: { descriptors: [descriptor('speed', 3), descriptor('use_sim_time', 1, true)] } },
      ],
      '/controller/set_parameters_atomically': [{ values: { result: { successful: true, reason: '' } } }],
    },
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.locator('.workspace-opening')).toHaveCount(0);
  const panel = page.locator('section.data-explorer-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Parameters', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Parameter node' }).selectOption('/controller');
  await expect(panel.getByRole('button', { name: 'Edit speed', exact: true })).toBeVisible();
  return panel;
}

test('browses, validates, reviews and submits native parameter updates', async ({ page }) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: 'Edit use_sim_time' }).click();
  await expect(panel.getByRole('button', { name: 'Stage change' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Edit speed', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Proposed value' }).fill('10');
  await panel.getByRole('button', { name: 'Stage change' }).click();
  await expect(panel.getByRole('alert')).toContainText('between 0 and 5');
  await panel.getByRole('textbox', { name: 'Proposed value' }).fill('2');
  await panel.getByRole('button', { name: 'Stage change' }).click();
  expect(await getRosServiceCalls(page, '/controller/set_parameters_atomically')).toEqual([]);
  await panel.getByRole('button', { name: 'Health', exact: true }).click();
  await panel.getByRole('button', { name: 'Parameters', exact: true }).click();
  await expect(panel.getByText('2 parameters · 1 staged')).toBeVisible();
  await panel.getByRole('button', { name: 'Review changes' }).click();
  await expect(panel.getByRole('region', { name: 'Review parameter changes' })).toContainText('1 → 2');
  await page.screenshot({ path: '/tmp/ros2-parameters-review.png' });
  await panel.getByRole('button', { name: 'Apply changes' }).click();
  await expect(panel.getByRole('status')).toContainText('1 of 1 changes applied');
  expect(await getRosServiceCalls(page, '/controller/set_parameters_atomically')).toEqual([
    {
      service: '/controller/set_parameters_atomically',
      type: 'rcl_interfaces/srv/SetParametersAtomically',
      args: { parameters: [{ name: 'speed', value: { type: 3, double_value: 2 } }] },
    },
  ]);
  await panel.getByRole('button', { name: 'Resources', exact: true }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/parameter_events')).toBe(0);
});

test('mobile observers can browse and review without applying; layout fits the tile', async ({ page }) => {
  const panel = await setup(page, { mobile: true, observer: true });
  await panel.getByRole('button', { name: 'Edit speed', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Proposed value' }).fill('2');
  await panel.getByRole('button', { name: 'Stage change' }).click();
  await panel.getByRole('button', { name: 'Review changes' }).click();
  await expect(panel.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await expect(panel.getByText('Request control from the top bar before applying changes.')).toBeVisible();
  await page.screenshot({ path: '/tmp/ros2-parameters-mobile.png' });
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await getRosServiceCalls(page, '/controller/set_parameters_atomically')).toEqual([]);
  await publishRosMessage(page, '/parameter_events', { node: '/controller' });
  await expect
    .poll(async () => (await getRosServiceCalls(page, '/controller/list_parameters')).length)
    .toBeGreaterThan(1);
});

test('opens from the node inspector and restores the selected node without restoring drafts', async ({ page }) => {
  const panel = await setup(page);
  await panel.getByRole('button', { name: 'Resources', exact: true }).click();
  await panel.getByRole('button', { name: /^Nodes/ }).click();
  await panel.locator('.de-resource-main', { hasText: '/controller' }).click();
  await panel.getByRole('button', { name: 'View parameters' }).click();
  await panel.getByRole('button', { name: 'Edit speed', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Proposed value' }).fill('2');
  await panel.getByRole('button', { name: 'Stage change' }).click();
  await expect(panel.getByText('2 parameters · 1 staged')).toBeVisible();
  // Workspace persistence is debounced; wait for its storage boundary before reloading.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.entries(localStorage)
            .filter(([key]) => key.startsWith('robo-boy-desktop-workspace-panels-v1:connection:'))
            .flatMap(([, value]) => JSON.parse(value))
            .find(item => item.id === 'parameters-test')?.panelState?.values?.config?.view
      )
    )
    .toBe('parameters');
  await page.reload();
  await page.getByRole('button', { name: /^127\.0\.0\.1 9090/ }).click();
  await expect(panel.getByRole('combobox', { name: 'Parameter node' })).toHaveValue('/controller');
  await expect(panel.getByText('2 parameters · 0 staged')).toBeVisible();
  expect(await getRosServiceCalls(page, '/controller/set_parameters_atomically')).toEqual([]);
});
