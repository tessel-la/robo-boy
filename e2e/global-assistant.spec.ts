import { test, expect, type Page } from '@playwright/test';
import { installRosMock } from './helpers/rosMock';

async function connectWithMockRos(page: Page) {
  await installRosMock(page);
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await expect(page.locator('#ros2Value')).toBeVisible();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
}

const mockOpenAiCompatibleChat = (page: Page, message: Record<string, unknown>) =>
  page.route('**/chat/completions', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(message) } }] })}\n\ndata: [DONE]\n\n`,
    })
  );

test('opens as a non-modal panel that does not block the rest of the app', async ({ page }) => {
  await connectWithMockRos(page);

  await page.getByLabel('Open Robo-Boy assistant').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();

  // Non-modal: elements behind the panel (the top bar) must still be reachable, unlike the old
  // BT-agent's full-page click-blocking overlay.
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
});

test('opening the assistant from a Behavior Tree panel pins its context without starting a second conversation', async ({
  page,
}) => {
  await connectWithMockRos(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();

  await page.getByTestId('bt-open-agent').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(1);

  // Ask something, close, and re-open from the BT button — must still be exactly one panel/
  // conversation, not a fresh one each time.
  await mockOpenAiCompatibleChat(page, { kind: 'explanation', message: 'This is a test answer.' });
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('What ROS topics are available?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('This is a test answer.')).toBeVisible();

  await page.getByLabel('Close assistant').click();
  await page.getByTestId('bt-open-agent').click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(1);
  // The prior turn is still there — reopening did not clear the conversation.
  await expect(page.getByText('This is a test answer.')).toBeVisible();
});

test('renders as a partial-height bottom sheet on mobile, leaving the top bar reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithMockRos(page);

  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();

  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  // A full-screen takeover would start at y=0; the bottom sheet must leave room above it.
  expect(panelBox!.y).toBeGreaterThan(100);
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
});
