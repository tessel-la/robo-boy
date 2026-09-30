import { expect, test, type Page } from '@playwright/test';
import {
  getActiveRosSubscriptionCount,
  getPublishedRosMessages,
  installRosMock,
  publishRosMessage,
} from './helpers/rosMock';

const graphTopic = '/roboboy/inspection/graph';
const metricsTopic = '/roboboy/inspection/metrics';
const requestTopic = '/roboboy/inspection/request';

async function connect(page: Page) {
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}

async function seed(page: Page, { mobile = false } = {}) {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 860 });
  await page.addInitScript(mobile => {
    if (localStorage.getItem('explorer-seeded')) return;
    localStorage.setItem('explorer-seeded', 'true');
    const panel = { id: 'explorer-test', type: 'dataExplorer', title: 'Data Explorer' };
    if (mobile) {
      localStorage.setItem('robo-boy-mobile-workspace-panels-v1', JSON.stringify([panel]));
    } else {
      localStorage.setItem('robo-boy-desktop-workspace-panels-v1', JSON.stringify([panel]));
      localStorage.setItem('robo-boy-desktop-workspace-tile-order-v1', JSON.stringify(['explorer-test']));
    }
  }, mobile);
  await installRosMock(page, {
    topics: [
      { name: '/scan', type: 'sensor_msgs/msg/LaserScan' },
      { name: '/speed', type: 'std_msgs/msg/Float64' },
      { name: '/diagnostics', type: 'diagnostic_msgs/msg/DiagnosticArray' },
    ],
  });
  await connect(page);
}

const companionGraph = {
  version: 1,
  revision: 1,
  age: 0,
  resources: [
    {
      kind: 'topic',
      name: '/scan',
      types: ['sensor_msgs/msg/LaserScan'],
      providers: ['/lidar'],
      consumers: ['/nav', '/roboboy_inspector'],
      publishers: 1,
      subscribers: 3,
      countKind: 'endpoints',
    },
    {
      kind: 'topic',
      name: '/speed',
      types: ['std_msgs/msg/Float64'],
      providers: ['/base'],
      consumers: ['/ui'],
      publishers: 2,
      subscribers: 1,
      countKind: 'endpoints',
    },
    {
      kind: 'service',
      name: '/reset',
      types: ['std_srvs/srv/Trigger'],
      providers: ['/base'],
      consumers: ['/ui'],
      servers: 1,
      clients: 4,
      countKind: 'endpoints',
    },
    {
      kind: 'action',
      name: '/navigate',
      types: ['nav2_msgs/action/NavigateToPose'],
      providers: ['/nav'],
      consumers: ['/ui'],
      servers: 1,
      clients: 1,
      countKind: 'nodes',
    },
    { kind: 'node', name: '/lidar', types: [], providers: [], consumers: [] },
    { kind: 'node', name: '/nav', types: [], providers: [], consumers: [] },
    { kind: 'node', name: '/base', types: [], providers: [], consumers: [] },
    { kind: 'node', name: '/ui', types: [], providers: [], consumers: [] },
  ],
};
const sendCompanion = async (page: Page, metrics: Record<string, unknown> = {}) => {
  await publishRosMessage(page, graphTopic, { data: JSON.stringify(companionGraph) });
  await publishRosMessage(page, metricsTopic, {
    data: JSON.stringify({ version: 1, graphRevision: 1, graphAge: 0, metrics }),
  });
  // The list first shows browser-discovered topics; wait for the companion's so a click is not raced by a re-render.
  await expect(explorer(page).locator('.de-resource-row', { hasText: '/speed' }).locator('.de-count')).toHaveText([
    '2',
    '1',
  ]);
};
const leases = async (page: Page) =>
  ((await getPublishedRosMessages(page, requestTopic)) as Array<{ data: string }>).map(message =>
    JSON.parse(message.data)
  );
// The workspace tile is also a region named after the panel; target the panel itself.
const explorer = (page: Page) => page.locator('section.data-explorer-panel');

test('reads companion counts for topics, services and actions and measures watched topics on the host', async ({
  page,
}) => {
  await seed(page);
  const panel = explorer(page);
  await expect(panel).toBeVisible();
  await sendCompanion(page);
  await expect(panel.getByText('ROS host', { exact: true })).toBeVisible();

  const scanRow = panel.locator('.de-resource-row', { hasText: '/scan' });
  // Publishers and subscribers have a column each.
  await expect(scanRow.locator('.de-count')).toHaveText(['1', '3']);
  await expect(scanRow.locator('.de-count').first()).toHaveAttribute('title', 'Endpoint count');

  // Rates exist only for topics: other kinds show only the columns that mean something for them.
  await expect(panel.locator('.de-table-heading')).toContainText('Hz');
  await expect(panel.locator('.de-table-heading')).toContainText('Actions');
  await expect(scanRow.getByRole('button')).toHaveCount(5); // The row itself and four icons: watch, record, rule, 3D.
  await panel.getByRole('button', { name: /^Services/ }).click();
  await expect(panel.locator('.de-table-heading')).not.toContainText('Hz');
  await expect(panel.locator('.de-resource-row', { hasText: '/reset' }).locator('.de-topic-actions')).toHaveCount(0);
  await expect(panel.locator('.de-table-heading')).toContainText('Srv');
  await expect(panel.locator('.de-resource-row', { hasText: '/reset' }).locator('.de-count')).toHaveText(['1', '4']);
  await panel.getByRole('button', { name: /^Nodes/ }).click();
  await expect(panel.locator('.de-table-heading')).toContainText('Sub');
  await expect(panel.locator('.de-table-heading')).not.toContainText('Actions');
  await expect(panel.locator('.de-resource-row', { hasText: '/base' }).locator('.de-count')).toHaveText(['1', '0']);
  await panel.getByRole('button', { name: /^Actions/ }).click();
  const action = panel.locator('.de-resource-row', { hasText: '/navigate' });
  await expect(action.locator('.de-count').first()).toHaveAttribute('title', 'Participating node count');

  // Watching a topic leases a host probe; the host's measurement is shown with its observation point.
  await panel.getByRole('button', { name: /^Topics/ }).click();
  await scanRow.getByRole('button', { name: 'Watch traffic of /scan' }).click();
  await scanRow.locator('.de-resource-main').click();
  await expect.poll(async () => (await leases(page)).some(lease => lease.watch.includes('/scan'))).toBe(true);
  await publishRosMessage(page, metricsTopic, {
    data: JSON.stringify({
      version: 1,
      graphRevision: 1,
      metrics: {
        '/scan': { source: 'host', rate: 10, bytesPerSec: 7200, age: 0.04, count: 100, window: 10, warming: false },
      },
    }),
  });
  await panel.getByRole('button', { name: 'Traffic', exact: true }).click();
  await expect(panel.getByText('Observed on ROS host · 10-second rolling window · best-effort probe')).toBeVisible();
  await expect(panel.locator('.de-stat-grid strong').first()).toHaveText('10 Hz');
  await expect(scanRow.locator('.de-rate')).toContainText('10');

  // Unwatching drops the measurement at once, not at the next metrics message.
  await panel.locator('.de-inspector').getByRole('button', { name: 'Stop watching /scan' }).click();
  await expect(scanRow.locator('.de-rate')).toHaveText('—');
  await expect.poll(async () => (await leases(page)).at(-1)?.watch).toEqual([]);
});

test('previews messages with freeze and field search, and releases subscriptions on close', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  await panel.locator('.de-resource-row', { hasText: '/speed' }).locator('.de-resource-main').click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/speed')).toBe(1);
  await publishRosMessage(page, '/speed', { data: 1.5, header: { frame_id: 'base' } });
  const tree = panel.locator('.de-value-node').first();
  await expect(tree).toContainText('1.5');

  await panel.getByRole('button', { name: 'Freeze message' }).click();
  await page.waitForTimeout(150);
  await publishRosMessage(page, '/speed', { data: 2.5, header: { frame_id: 'base' } });
  await page.waitForTimeout(700);
  await expect(tree).toContainText('1.5');
  await expect(tree).not.toContainText('2.5');
  await panel.getByRole('button', { name: 'Resume message' }).click();
  await expect(tree).toContainText('2.5');

  await panel.getByLabel('Find a field').fill('frame');
  await expect(panel.getByText('frame_id')).toBeVisible();
  await expect(panel.locator('.de-value-line strong', { hasText: /^data$/ })).toHaveCount(0);

  await page.getByRole('button', { name: /Remove Data Explorer/ }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/speed')).toBe(0);
  await expect.poll(async () => (await leases(page)).at(-1)?.release).toBe(true);
});

test('draws the graph with service clients pointing at servers', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  await panel.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(panel.locator('.react-flow__node', { hasText: 'TOPIC /scan · 1 → 3' })).toBeVisible();
  await panel.getByRole('button', { name: /^Services/ }).click();
  await expect(panel.locator('.react-flow__node', { hasText: 'SERVICE /reset · 4 → 1' })).toBeVisible();
  const ui = await panel.locator('.react-flow__node', { hasText: /^\/ui$/ }).boundingBox();
  const base = await panel.locator('.react-flow__node', { hasText: /^\/base$/ }).boundingBox();
  expect(ui!.x).toBeLessThan(base!.x); // The client sends, so it sits left of the server.
  // Switching layer refits the view once the new nodes are measured: every node is inside the canvas.
  const canvas = (await panel.locator('.react-flow').boundingBox())!;
  await expect
    .poll(async () => {
      const boxes = await panel
        .locator('.react-flow__node')
        .evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
      return boxes.every(
        box =>
          box.left >= canvas.x - 1 &&
          box.right <= canvas.x + canvas.width + 1 &&
          box.top >= canvas.y - 1 &&
          box.bottom <= canvas.y + canvas.height + 1
      );
    })
    .toBe(true);
});

test('shows diagnostics with severity text and logs from /rosout', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  await panel.getByRole('button', { name: 'Health', exact: true }).click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/diagnostics')).toBe(1);
  await publishRosMessage(page, '/diagnostics', {
    status: [
      { name: 'motor', hardware_id: 'm1', level: 1, message: 'Hot', values: [{ key: 'temperature', value: '71' }] },
      { name: 'battery', hardware_id: 'b1', level: 0, message: 'OK', values: [] },
    ],
  });
  await expect(panel.locator('.de-diagnostic', { hasText: 'motor' }).locator('.de-severity')).toHaveText('Warning');
  await expect(panel.getByText('2 components')).toBeVisible();
  await publishRosMessage(page, '/rosout', { name: 'planner', level: 30, msg: 'Path blocked' });
  await panel.getByRole('button', { name: 'Logs', exact: true }).click();
  await expect(panel.locator('.de-log-list li', { hasText: 'Path blocked' })).toContainText('Warn');
});

test('labels browser-only inspection honestly when the companion is absent', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await expect(panel.getByText('Companion unavailable · limited inspection')).toBeVisible();
  const scanRow = panel.locator('.de-resource-row', { hasText: '/scan' });
  await expect(scanRow.locator('.de-count')).toHaveText(['—', '—']);
  await scanRow.getByRole('button', { name: 'Watch traffic of /scan' }).click();
  await scanRow.locator('.de-resource-main').click();
  await panel.getByRole('button', { name: 'Traffic', exact: true }).click();
  await expect(panel.getByText(/Received in the browser · previews are throttled to 10 per second/)).toBeVisible();
});

test('opens selected data in Time Series and 3D', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  await panel.locator('.de-resource-row', { hasText: '/speed' }).locator('.de-resource-main').click();
  await expect.poll(() => getActiveRosSubscriptionCount(page, '/speed')).toBe(1);
  await publishRosMessage(page, '/speed', { data: 4 });
  await panel.getByRole('button', { name: 'Plot data' }).click();
  await expect(page.locator('section.timeseries-panel')).toBeVisible();
  await expect(page.locator('section.timeseries-panel')).toContainText('/speed');

  // Row icons act on their topic directly, without opening its inspector.
  await panel.getByRole('button', { name: 'Back to resources' }).click();
  await panel
    .locator('.de-resource-row', { hasText: '/scan' })
    .getByRole('button', { name: 'Open in 3D: /scan' })
    .click();
  await expect(page.locator('.workspace-card-3d, [class*="workspace-card-3d"]').first()).toBeVisible();

  // Opening again reuses the 3D panel and keeps what the user set up there instead of resetting it.
  const layers = () =>
    page.evaluate(async () => {
      const key = Object.keys(localStorage).find(name => name.startsWith('roboboy_3d_visualization_state_'));
      const state = await import('/src/utils/visualizationState.ts');
      return key ? state.getVisualizationStateForKey(key).visualizations.map(item => item.topic) : [];
    });
  await expect.poll(layers).toEqual(['/scan']);
  await page.evaluate(async () => {
    const key = Object.keys(localStorage).find(name => name.startsWith('roboboy_3d_visualization_state_'))!;
    const state = await import('/src/utils/visualizationState.ts');
    const current = state.getVisualizationStateForKey(key);
    state.saveVisualizationStateForKey(key, {
      ...current,
      fixedFrame: 'odom',
      visualizations: [...current.visualizations, { id: 'kept', type: 'pointcloud', topic: '/cloud' }],
    });
  });
  await panel
    .locator('.de-resource-row', { hasText: '/scan' })
    .getByRole('button', { name: 'Open in 3D: /scan' })
    .click();
  await expect.poll(layers).toEqual(['/scan', '/cloud']);
  await expect(page.locator('.workspace-card-3d, [class*="workspace-card-3d"]')).toHaveCount(1);
});

test('fits a narrow phone layout: list first, inspector with Back, no sideways scrolling', async ({ page }) => {
  await seed(page, { mobile: true });
  const panel = explorer(page);
  await expect(panel).toBeVisible();
  await sendCompanion(page);
  await panel.locator('.de-resource-row', { hasText: '/scan' }).locator('.de-resource-main').click();
  await expect(panel.getByRole('button', { name: 'Back to resources' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await panel.getByRole('button', { name: 'Back to resources' }).click();
  await expect(panel.locator('.de-resource-row', { hasText: '/scan' })).toBeVisible();
});

test('selects several topics for bulk actions, sorts by column and resizes columns', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  const row = (name: string) => panel.locator('.de-resource-row', { hasText: name });

  // Sort by a count column: the first click sorts largest first, the next reverses.
  const names = () => panel.locator('.de-resource-row strong').allTextContents();
  await panel.getByRole('button', { name: 'Sort by Publishers' }).click();
  await expect.poll(names).toEqual(['/speed', '/scan']);
  await expect(panel.locator('.de-heading-cell.is-sorted')).toHaveAttribute('aria-sort', 'descending');
  await panel.getByRole('button', { name: 'Sort by Publishers' }).click();
  await expect.poll(names).toEqual(['/scan', '/speed']);
  await panel.getByRole('button', { name: 'Sort by Subscribers' }).click();
  await expect.poll(names).toEqual(['/scan', '/speed']);

  // Check two rows, then act on both at once.
  await row('/scan').getByRole('checkbox', { name: 'Select /scan' }).check();
  await row('/speed').getByRole('checkbox', { name: 'Select /speed' }).check();
  const bar = panel.getByRole('toolbar', { name: 'Selected resources' });
  await expect(bar).toContainText('2 selected');
  await expect(panel.getByRole('checkbox', { name: 'Clear selection' })).toBeChecked();
  await bar.getByRole('button', { name: 'Watch traffic of the selected topics' }).click();
  await expect
    .poll(async () => (await leases(page)).at(-1)?.watch)
    .toEqual(expect.arrayContaining(['/scan', '/speed']));
  // With every checked topic watched, the same button stops watching them.
  await bar.getByRole('button', { name: 'Stop watching the selected topics' }).click();
  await expect.poll(async () => (await leases(page)).at(-1)?.watch ?? []).toEqual([]);
  await bar.getByRole('button', { name: 'Add a health rule to each selected topic' }).click();
  await bar.getByRole('button', { name: 'Clear selection' }).click();
  await expect(bar).toHaveCount(0);
  // A topic's rule icon opens the rule where it can be edited.
  await row('/scan').getByRole('button', { name: 'Show health rule for /scan' }).click();
  await expect(panel.getByRole('button', { name: 'Rules', exact: true, pressed: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Resources', exact: true }).click();

  // Columns resize from the keyboard as well as by dragging, and heading and rows stay aligned.
  const handle = panel.getByRole('separator', { name: 'Resize Pub column' });
  await handle.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '80');
  const heading = await panel.locator('.de-heading-cell', { hasText: 'Pub' }).boundingBox();
  const cell = await row('/scan').locator('.de-count').first().boundingBox();
  expect(Math.abs(heading!.x - cell!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(heading!.width - cell!.width)).toBeLessThanOrEqual(1);
});

test('records several selected topics together', async ({ page }) => {
  await seed(page);
  const panel = explorer(page);
  await sendCompanion(page);
  await panel.getByRole('checkbox', { name: 'Select all shown' }).check();
  await panel.getByRole('button', { name: 'Open recording settings with the selected topics' }).click();
  const recorder = page.locator('.record-replay-panel');
  await expect(recorder).toBeVisible();
  await expect(recorder.getByRole('checkbox', { name: '/scan' })).toBeChecked();
  await expect(recorder.getByRole('checkbox', { name: '/speed' })).toBeChecked();
});
