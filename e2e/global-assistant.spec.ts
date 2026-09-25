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

test('uses a bottom-right launcher and opens a floating panel docked on the same side', async ({ page }) => {
  await connectWithMockRos(page);
  const launcher = page.getByLabel('Open Robo-Boy assistant');
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox!.x + launcherBox!.width).toBeGreaterThan(
    (await page.evaluate(() => window.innerWidth)) - 30
  );
  expect(launcherBox!.y + launcherBox!.height).toBeGreaterThan((await page.evaluate(() => window.innerHeight)) - 30);
  await launcher.click();

  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel).toHaveClass(/tree-panel-resize-frame/);
  await expect(page.locator('.assistant-resize-handle.tree-panel-menu-resize-handle')).toHaveCount(4);
  const northwestCorner = panel.locator('.tree-panel-menu-resize-handle.nw');
  const cornerStyle = await northwestCorner.evaluate(element => {
    const handle = getComputedStyle(element);
    const marker = getComputedStyle(element, '::after');
    return {
      width: handle.width,
      opacity: handle.opacity,
      markerWidth: marker.width,
      markerBorderTop: marker.borderTopWidth,
      markerBorderLeft: marker.borderLeftWidth,
    };
  });
  expect(cornerStyle).toEqual({
    width: '24px',
    opacity: '0.48',
    markerWidth: '14px',
    markerBorderTop: '2px',
    markerBorderLeft: '2px',
  });
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(420);
  expect(box!.width).toBeLessThanOrEqual(481);
  // Docked against the right edge, where the launcher was pressed.
  expect(Math.abs(box!.x + box!.width - (await page.evaluate(() => window.innerWidth)))).toBeLessThanOrEqual(2);

  // Floating: the header drags it, an edge resizes it, and a double-click docks it again.
  const header = page.locator('.assistant-header');
  const headerBox = (await header.boundingBox())!;
  await page.mouse.move(headerBox.x + 200, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x - 100, headerBox.y + 60, { steps: 5 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(Math.round(moved.x)).toBe(Math.round(box!.x - 300));
  const westHandle = (await page.locator('.assistant-resize-handle.w').boundingBox())!;
  const grab = { x: westHandle.x + westHandle.width / 2, y: westHandle.y + 200 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x - 80, grab.y, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(moved.width + 80));
  await header.dblclick({ position: { x: 200, y: 20 } });
  const docked = (await panel.boundingBox())!;
  expect(Math.abs(docked.x + docked.width - (await page.evaluate(() => window.innerWidth)))).toBeLessThanOrEqual(2);
  await expect(page.locator('.assistant-minimize, .assistant-sheet-handle')).toHaveCount(0);
  // Nothing to choose: everything the app holds is carried every turn.
  await expect(page.getByRole('button', { name: /^Context/ })).toHaveCount(0);
  await expect(page.getByLabel('Status: Connected')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('keeps the launcher visible and reverses the panel animation when toggled', async ({ page }) => {
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();

  const panel = page.getByTestId('assistant-panel');
  const closeLauncher = page.getByLabel('Close Robo-Boy assistant', { exact: true });
  await expect(panel).toBeVisible();
  await expect(closeLauncher).toBeVisible();
  await expect(closeLauncher).toHaveAttribute('aria-expanded', 'true');
  const entrance = await panel.evaluate(element => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(entrance.name).toBe('assistant-panel-enter');
  expect(entrance.duration).toBe('0.26s');
  await closeLauncher.click();
  await expect(panel).toHaveClass(/is-closing/);
  const exit = await panel.evaluate(element => {
    const style = getComputedStyle(element);
    return { name: style.animationName, duration: style.animationDuration };
  });
  expect(exit.name).toBe('assistant-panel-exit');
  expect(exit.duration).toBe('0.21s');
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel('Open Robo-Boy assistant')).toBeVisible();
});

test('adds a Behavior Tree panel to the workspace when asked to edit the layout', async ({ page }) => {
  await connectWithMockRos(page);
  await mockOpenAiCompatibleChat(page, {
    kind: 'workspaceEdit',
    summary: 'Added a Behavior tree panel.',
    operations: [{ op: 'addPanel', panelType: 'behaviorTree' }],
  });
  await expect(page.getByRole('region', { name: 'Behavior tree' })).toHaveCount(0);

  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('edit the layout and add the bt panel');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('assistant-workspace-edit-card')).toContainText('Added a Behavior tree panel.');
  await expect(page.getByRole('region', { name: 'Behavior tree' })).toBeVisible();
});

test('adds a visible Behavior Tree panel from the assistant on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithMockRos(page);
  await mockOpenAiCompatibleChat(page, {
    kind: 'workspaceEdit',
    summary: 'Added a Behavior tree panel.',
    operations: [{ op: 'addPanel', panelType: 'behaviorTree' }],
  });

  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('add the BT panel');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('assistant-workspace-edit-card')).toContainText('Added a Behavior tree panel.');
  await page.getByLabel('Close assistant').click();
  await expect(page.getByRole('region', { name: 'Behavior tree' })).toBeVisible();
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
  await expect(panel).toHaveClass(/is-open/);
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

  // The composer is what gets tapped over and over, so it keeps full-size touch targets. The
  // header's two chrome controls are deliberately smaller: a second full-height title bar under the
  // app bar costs transcript room it cannot earn, and back also closes the panel.
  const composerControls = await panel.locator('.assistant-speech-toolbar button:visible').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect())
  );
  expect(composerControls.length).toBeGreaterThan(0);
  expect(composerControls.every(box => box.width >= 44 && box.height >= 44)).toBe(true);

  const headerControls = await panel.locator('.assistant-header button:visible').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect())
  );
  expect(headerControls.every(box => box.width >= 36 && box.height >= 36)).toBe(true);
  const headerHeight = (await panel.locator('.assistant-header').boundingBox())!.height;
  expect(headerHeight).toBeLessThanOrEqual(40);
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
  const landscapePanel = page.getByTestId('assistant-panel');
  await expect(landscapePanel).toHaveClass(/is-open/);
  const box = await landscapePanel.boundingBox();
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
  // Firefox serializes small durations as decimals; Chromium may use exponent notation.
  const durationMs = Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
  expect(durationMs).toBeLessThanOrEqual(0.001);
});

test('the launcher uses the former theme corner and theme selection stays in the session menu', async ({ page }) => {
  await connectWithMockRos(page);
  const launcher = page.getByLabel('Open Robo-Boy assistant');

  for (const size of [{ width: 1440, height: 900 }, { width: 700, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect(async () => {
      const launcherBox = await launcher.boundingBox();
      expect(launcherBox!.x + launcherBox!.width).toBeGreaterThan(size.width - 30);
      expect(launcherBox!.y + launcherBox!.height).toBeGreaterThan(size.height - 30);
    }).toPass();
  }

  // A phone's gesture bar lifts the launcher clear of the system's bottom inset.
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-bottom', '48px'));
  await expect(async () => {
    const launcherBox = await launcher.boundingBox();
    expect(launcherBox!.y + launcherBox!.height).toBeLessThanOrEqual(844 - 48);
  }).toPass();
  await page.evaluate(() => document.documentElement.style.removeProperty('--safe-area-bottom'));

  await expect(page.getByLabel('Select theme')).toHaveCount(0);
  await page.getByRole('button', { name: /Switch connections, current/ }).click();
  await expect(page.getByLabel('Select theme')).toBeVisible();

  await launcher.click();
  await expect(page.getByLabel('Select theme')).toHaveCount(0);
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.getByLabel('Close assistant').click();
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
  await expect(draftTag).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.getByText('Tag noted.')).toBeVisible();
  const sentTag = page.locator('.assistant-message .assistant-inline-tag');
  await expect(sentTag).toHaveText('@/cmd_vel');
  await expect(sentTag).toBeVisible();

  // Repeating re-sends the same tagged context rather than dropping it.
  await page.getByLabel('Repeat').click();
  await expect(page.locator('.assistant-message .assistant-inline-tag')).toHaveText('@/cmd_vel');

  // An already-sent message can be tagged while being edited, with the same picker and colouring.
  await page.getByLabel('Edit message').first().click();
  const editor = page.getByLabel('Edit message', { exact: true });
  await editor.click();
  await editor.press('End');
  await editor.type(' and @diagn');
  await page.getByRole('option', { name: /\/diagnostics/ }).click();
  await expect(editor).toHaveValue('describe @/cmd_vel and @/diagnostics ');
  await expect(page.locator('.assistant-message-edit .assistant-inline-tag')).toHaveText(['@/cmd_vel', '@/diagnostics']);

  await page.getByRole('button', { name: /Save/ }).click();
  await expect(page.locator('.assistant-message .assistant-inline-tag')).toHaveText(['@/cmd_vel', '@/diagnostics']);
});
