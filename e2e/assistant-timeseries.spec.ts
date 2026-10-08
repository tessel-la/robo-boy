import { test, expect } from '@playwright/test';
import { installRosMock, publishRosMessage, getActiveRosSubscriptionCount } from './helpers/rosMock';

for (const mode of ['desktop', 'mobile', 'missing-follow-up'] as const) {
  test(`creates and configures a joint-state plot (${mode})`, async ({ page }) => {
    if (mode === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    await installRosMock(page, { topics: [{ name: '/robot/joint_states', type: 'sensor_msgs/msg/JointState' }] });
    await page.goto('/');
    await page.getByTitle('Advanced Options').click();
    await page.locator('#ros2Value').fill('127.0.0.1');
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByLabel('Status: Connected')).toBeVisible();
    await expect(page.getByRole('status', { name: /^Connected to / })).toHaveCount(0);

    const prompts: string[] = [];
    const configure = {
      op: 'configurePanel',
      panelType: 'timeSeries',
      settings: {
        addSignals: [
          {
            topic: '/robot/joint_states',
            messageType: 'sensor_msgs/msg/JointState',
            fieldPath: 'position[0]',
            label: 'shoulder',
            unit: 'rad',
          },
          {
            topic: '/robot/joint_states',
            messageType: 'sensor_msgs/msg/JointState',
            fieldPath: 'position[1]',
            label: 'elbow',
            unit: 'rad',
          },
        ],
      },
    };
    await page.route('**/chat/completions', route => {
      const request = route.request().postDataJSON();
      prompts.push(request.messages[0].content);
      const first = prompts.length === 1;
      const response = first
        ? {
            kind: 'workspaceEdit',
            summary: 'Joint plot created.',
            operations: [
              { op: 'addPanel', panelType: 'timeSeries', title: 'Joint positions' },
              ...(mode === 'missing-follow-up' ? [] : [configure]),
            ],
          }
        : mode === 'missing-follow-up' && prompts.length === 2
          ? { kind: 'workspaceEdit', summary: 'Joint plot configured.', operations: [configure] }
          : { kind: 'explanation', message: 'The joint plot is receiving data.' };
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(response) } }] })}\n\ndata: [DONE]\n\n`,
      });
    });
    // Simulate a publishing robot for the bounded assistant sample and the panel subscription.
    const timer = await page.evaluate(() =>
      window.setInterval(
        () =>
          (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void }).__publishRosTopic(
            '/robot/joint_states',
            { name: ['shoulder', 'elbow'], position: [0.2, -0.3], velocity: [], effort: [] }
          ),
        100
      )
    );
    await page.getByLabel('Open Robo-Boy assistant').click();
    await page
      .getByRole('textbox', { name: 'Ask the assistant', exact: true })
      .fill('add a timeserie panel with the joints states showing in the ui');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByTestId('assistant-workspace-edit-card').last()).toContainText('Added "elbow".');
    expect(prompts[0]).toContain('"name":["shoulder","elbow"]');
    expect(prompts[0]).toContain('position[0]');
    if (mode === 'missing-follow-up') {
      expect(prompts[1]).toContain('"type":"timeSeries"');
      expect(prompts[1]).toContain('"signals":[]');
      expect(prompts[1]).toContain('"addSignals"');
    }
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    const plot = page.getByRole('region', { name: 'Time Series', exact: true });
    await expect(plot).toHaveCount(1);
    await expect(plot.getByRole('button', { name: 'shoulder', exact: true })).toContainText('0.2 rad');
    await expect(plot.getByRole('button', { name: 'elbow', exact: true })).toContainText('-0.3 rad');
    await expect.poll(() => getActiveRosSubscriptionCount(page, '/robot/joint_states')).toBe(1);
    await page.evaluate(id => window.clearInterval(id), timer);
    await publishRosMessage(page, '/robot/joint_states', { name: ['shoulder', 'elbow'], position: [0.5, -0.6] });
    await expect(plot.getByRole('button', { name: 'shoulder', exact: true })).toContainText('0.5 rad');
    await expect(plot.getByRole('button', { name: 'elbow', exact: true })).toContainText('-0.6 rad');
    if (mode === 'desktop') await page.screenshot({ path: 'test-results/assistant-joint-timeseries.png' });

    await page.getByLabel('Open Robo-Boy assistant').click();
    await page
      .getByRole('textbox', { name: /Ask the assistant|Continue the conversation/ })
      .fill('what does the time series panel show?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('The joint plot is receiving data.')).toBeVisible();
    expect(prompts.at(-1)).toContain('"connected":true');
    expect(prompts.at(-1)).toContain('"fieldPath":"position[1]"');
    expect(prompts.at(-1)).toContain('"latestSampleAt":');
    expect(prompts.at(-1)).toContain('plotting,');
  });
}
