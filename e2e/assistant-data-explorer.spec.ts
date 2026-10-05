import { test, expect } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

test('opens a Data Explorer, watches a topic and adds a health rule from the assistant', async ({ page }) => {
  await installRosMock(page, {
    topics: [
      { name: '/scan', type: 'sensor_msgs/msg/LaserScan' },
      { name: '/odom', type: 'nav_msgs/msg/Odometry' },
    ],
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  const prompts: string[] = [];
  await page.route('**/chat/completions', route => {
    const request = route.request().postDataJSON();
    prompts.push(request.messages[0].content);
    const response =
      prompts.length === 1
        ? {
            kind: 'workspaceEdit',
            summary: 'Watching /scan.',
            operations: [
              { op: 'addPanel', panelType: 'dataExplorer' },
              {
                op: 'configurePanel',
                panelType: 'dataExplorer',
                settings: { watch: ['/scan'], addRules: [{ topic: '/scan', minHz: 5 }], select: '/scan' },
              },
            ],
            followUp: 'Report on /scan.',
          }
        : { kind: 'explanation', message: '/scan is watched and has a rule.' };
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(response) } }] })}\n\ndata: [DONE]\n\n`,
    });
  });

  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant', exact: true }).fill('watch /scan and alert me below 5 Hz');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByText('/scan is watched and has a rule.')).toBeVisible();
  await expect(page.getByTestId('assistant-workspace-edit-card').first()).toContainText('Watching /scan.');
  await expect(page.getByTestId('assistant-workspace-edit-card').first()).toContainText('Added the health rule for /scan');

  const explorer = page.locator('section.data-explorer-panel');
  await expect(explorer).toBeVisible();
  await expect(explorer.getByRole('complementary', { name: '/scan inspector' })).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Stop watching /scan' }).first()).toBeVisible();
  await expect(explorer.getByRole('button', { name: 'Show health rule for /scan' }).first()).toBeVisible();

  // The follow-up turn sees what the panel now holds.
  expect(prompts[0]).toContain('Data Explorer');
  expect(prompts[1]).toContain('"watched":["/scan"]');
  expect(prompts[1]).toContain('"rules":[{"topic":"/scan","minHz":5');
  expect(prompts[1]).toContain('"selectedResource":{"kind":"topic","name":"/scan"');
});
