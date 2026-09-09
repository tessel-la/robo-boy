import { test, expect, type Page } from '@playwright/test';
import { installRosMock, waitForRosSubscription } from './helpers/rosMock';

async function connectWithMockRos(page: Page) {
  await installRosMock(page, {
    topics: [
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' },
      { name: '/diagnostics', type: 'diagnostic_msgs/msg/DiagnosticArray' },
    ],
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
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

test('uses a bottom-left launcher and opens a stable panel from the same side', async ({ page }) => {
  await connectWithMockRos(page);
  const launcher = page.getByLabel('Open Robo-Boy assistant');
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox!.x).toBeLessThan(30);
  expect(launcherBox!.y + launcherBox!.height).toBeGreaterThan((await page.evaluate(() => window.innerHeight)) - 30);
  await launcher.click();

  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(420);
  expect(box!.width).toBeLessThanOrEqual(481);
  expect(box!.x).toBe(0);
  await expect(page.locator('.assistant-resize-handle, .assistant-minimize, .assistant-sheet-handle')).toHaveCount(0);
  await expect(page.locator('.theme-selector-container')).toBeVisible();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.theme-selector-container')).toBeVisible();
});

test('Enter sends, Shift+Enter keeps editing, and parsing status clears after a reply', async ({ page }) => {
  await connectWithMockRos(page);
  await mockOpenAiCompatibleChat(page, { kind: 'explanation', message: 'Keyboard response.' });
  await page.getByLabel('Open Robo-Boy assistant').click();
  const prompt = page.getByRole('textbox', { name: 'Ask the assistant' });
  await prompt.fill('first line');
  await page.keyboard.press('Shift+Enter');
  await expect(prompt).toHaveValue('first line\n');
  await prompt.fill('send this');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Keyboard response.')).toBeVisible();
  await expect(page.getByText('Parsing response…')).toHaveCount(0);
});

test('context browser groups exact resources and captures a bounded selected topic', async ({ page }) => {
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('button', { name: /Context/ }).click();

  await expect(page.getByRole('dialog', { name: 'Add context' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Add context' });
  for (const heading of ['Current workspace', 'Pads', 'Behavior Trees', 'ROS topics', 'ROS services', 'ROS actions', 'ROS nodes', 'ROS parameters', 'TF and diagnostics']) {
    await expect(dialog.locator('.assistant-context-section-heading').getByText(heading, { exact: true })).toBeVisible();
  }
  await page.getByPlaceholder('Search Pads, trees, topics, services…').fill('cmd_vel');
  const topicButton = page.getByRole('button', { name: /\/cmd_vel/ });
  await topicButton.click();
  await waitForRosSubscription(page, '/cmd_vel');
  await page.evaluate(() => {
    (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void })
      .__publishRosTopic('/cmd_vel', { linear: { x: 0.25 }, angular: { z: 0 } });
  });
  // Choosing from the browser tags the prompt, exactly as typing the mention does.
  await expect(page.getByRole('textbox', { name: 'Ask the assistant' })).toHaveValue('@/cmd_vel ');
});

test('computes a human-spaced btw TF distance from live /tf data without the provider', async ({ page }) => {
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  const prompt = page.getByRole('textbox', { name: 'Ask the assistant' });
  await prompt.fill('compute distance btw panda link 0 and panda hand');
  await page.keyboard.press('Enter');
  await Promise.all([waitForRosSubscription(page, '/tf'), waitForRosSubscription(page, '/tf_static')]);
  await page.evaluate(() => {
    const publish = (window as unknown as { __publishRosTopic: (topic: string, message: unknown) => void }).__publishRosTopic;
    publish('/tf_static', {
      transforms: [
        { header: { frame_id: 'panda_link0', stamp: { sec: 1, nanosec: 0 } }, child_frame_id: 'panda_link1', transform: { translation: { x: 0.3, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } },
        { header: { frame_id: 'panda_link1', stamp: { sec: 1, nanosec: 0 } }, child_frame_id: 'panda_hand', transform: { translation: { x: 0.2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } },
      ],
    });
  });
  await expect(page.getByText(/distance.*0.5 m/i)).toBeVisible();
  await expect(page.getByText(/panda_link0.*panda_link1.*panda_hand/)).toBeVisible();
});

test('Behavior Tree entry reuses the one global conversation', async ({ page }) => {
  await connectWithMockRos(page);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
  await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();
  await page.getByTestId('bt-open-agent').click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(1);

  await mockOpenAiCompatibleChat(page, { kind: 'explanation', message: 'This is a test answer.' });
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('What does this Behavior Tree do?');
  await page.keyboard.press('Enter');
  await expect(page.getByText('This is a test answer.')).toBeVisible();
  await page.getByLabel('Close assistant').click();
  await page.getByTestId('bt-open-agent').click();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(1);
  await expect(page.getByText('This is a test answer.')).toBeVisible();
});

test('320px portrait keeps header, transcript, context, and composer reachable above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  const header = panel.locator('.assistant-header');
  const composer = panel.locator('.assistant-composer');
  await expect(header).toBeVisible();
  await expect(composer).toBeVisible();
  let box = await panel.boundingBox();
  expect(box!.x).toBe(0);
  expect(box!.width).toBe(320);
  expect(box!.y).toBeGreaterThanOrEqual(40);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);

  await page.getByRole('textbox', { name: 'Ask the assistant' }).focus();
  await page.setViewportSize({ width: 320, height: 360 });
  await expect(header).toBeVisible();
  await expect(composer).toBeVisible();
  // The panel re-measures the visual viewport from a resize listener, so poll rather than race it.
  await expect(async () => {
    const resized = await panel.boundingBox();
    expect(resized!.y + resized!.height).toBeLessThanOrEqual(360);
  }).toPass();

  const controls = await panel.locator('button:visible').evaluateAll(buttons =>
    buttons.slice(0, 8).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height }))
  );
  expect(controls.every(control => control.width >= 40 && control.height >= 40)).toBe(true);
});

test('mobile back closes the full-height assistant and landscape uses a side panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('assistant-panel')).toHaveCount(0);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByLabel('Open Robo-Boy assistant').click();
  const box = await page.getByTestId('assistant-panel').boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(420);
  expect(box!.width).toBeLessThan(844);
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
});

test('honors reduced motion in the assistant surface', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  const duration = await page.getByTestId('assistant-panel').evaluate(element =>
    getComputedStyle(element.querySelector('.spinning') ?? element).animationDuration
  );
  expect(['0s', '0.001ms']).toContain(duration);
});

test('the launcher matches the theme button and yields the corner to the full-screen assistant', async ({ page }) => {
  await connectWithMockRos(page);
  const launcher = page.getByLabel('Open Robo-Boy assistant');
  const theme = page.getByLabel('Select theme');

  for (const size of [{ width: 1440, height: 900 }, { width: 700, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    // Both buttons animate their size, so compare once the transition has settled.
    await expect(async () => {
      const [launcherBox, themeBox] = [await launcher.boundingBox(), await theme.boundingBox()];
      expect(launcherBox!.width).toBe(themeBox!.width);
      expect(launcherBox!.height).toBe(themeBox!.height);
      expect(launcherBox!.y).toBe(themeBox!.y);
    }).toPass();
  }

  await launcher.click();
  await expect(theme).toBeHidden();
  await page.getByLabel('Close assistant').click();
  await expect(theme).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Open Robo-Boy assistant').click();
  await expect(theme).toBeVisible();
});

test('a tagged resource stays in the prompt and reads as a coloured tag in the transcript', async ({ page }) => {
  await connectWithMockRos(page);
  await mockOpenAiCompatibleChat(page, { kind: 'explanation', message: 'Tag noted.' });
  await page.getByLabel('Open Robo-Boy assistant').click();
  const prompt = page.getByRole('textbox', { name: 'Ask the assistant' });
  await prompt.fill('describe @cmd_v');
  await page.getByRole('option', { name: /\/cmd_vel/ }).click();
  await waitForRosSubscription(page, '/cmd_vel');
  await expect(prompt).toHaveValue('describe @/cmd_vel ');

  // The mention itself is the tag, so nothing is repeated above the composer.
  await expect(page.getByLabel('Remove Topic: /cmd_vel from context')).toHaveCount(0);

  // Typing continues after the mention rather than at the start of the prompt.
  await page.keyboard.type('now');
  await expect(prompt).toHaveValue('describe @/cmd_vel now');
  await prompt.fill('describe @/cmd_vel ');

  // The draft is highlighted through a backdrop behind the textarea, before the retrieval lands.
  const draftTag = page.locator('.assistant-textarea-highlight .assistant-inline-tag');
  await expect(draftTag).toHaveText('@/cmd_vel');
  await expect(draftTag).toHaveClass(/source-ros/);

  await page.keyboard.press('Enter');
  await expect(page.getByText('Tag noted.')).toBeVisible();
  const sentTag = page.locator('.assistant-message .assistant-inline-tag');
  await expect(sentTag).toHaveText('@/cmd_vel');
  await expect(sentTag).toHaveClass(/source-ros/);

  // Repeating and editing re-send the same tagged context rather than dropping it.
  await page.getByLabel('Repeat').click();
  await expect(page.locator('.assistant-message .assistant-inline-tag')).toHaveText('@/cmd_vel');
  await page.getByLabel('Edit message').first().click();
  await page.getByLabel('Edit message', { exact: true }).fill('describe @/cmd_vel again');
  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.assistant-message .assistant-inline-tag')).toHaveText('@/cmd_vel');
});
