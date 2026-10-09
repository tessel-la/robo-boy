import { test, expect, type Page } from '@playwright/test';
import { installRosMock, waitForRosSubscription } from './helpers/rosMock';
import { assistantStream } from './helpers/assistantMock';

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
  // The opening screen steps aside just after; hover-dependent styles are only settled once it has.
  await expect(page.getByRole('status', { name: /^Connected to / })).toHaveCount(0);
}

const mockOpenAiCompatibleChat = (page: Page, message: Record<string, unknown>) =>
  page.route('**/chat/completions', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: assistantStream(route.request().postDataJSON().messages.some((turn: { role: string }) => turn.role === 'tool') ? { kind: 'explanation', message: 'The proposal is ready for review.' } : message),
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
  // Measure idle corners with the pointer outside the frame.
  await page.mouse.move(20, 20);

  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel).toHaveClass(/tree-panel-resize-frame/);
  await expect(page.locator('.assistant-resize-handle.tree-panel-menu-resize-handle')).toHaveCount(4);
  const northwestCorner = panel.locator('.tree-panel-menu-resize-handle.nw');
  // Focus-within intentionally highlights the handles. Establish both states explicitly
  // instead of assuming that moving the pointer also removes keyboard focus.
  const composer = page.locator('#assistant-prompt');
  await composer.focus();
  await expect(composer).toBeFocused();
  await expect.poll(() => northwestCorner.evaluate(element => getComputedStyle(element).opacity)).toBe('0.9');
  await composer.evaluate(element => element.blur());
  await expect.poll(() => northwestCorner.evaluate(element => getComputedStyle(element).opacity)).toBe('0.48');
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

for (const theme of ['light', 'dark', 'solarized', 'custom-cobalt']) {
  for (const width of [320, 390, 1280]) {
    test(`assistant views fit ${theme} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.addInitScript(themeId => {
        localStorage.setItem('appTheme', themeId);
        localStorage.setItem('customThemes', JSON.stringify([{
          id: 'custom-cobalt', name: 'Cobalt UI test', fontFamily: 'Verdana, Geneva, sans-serif',
          colors: { primary: '#ff6132', secondary: '#78a3ff', background: '#10246b', cardBg: '#1c3681', text: '#fff5dc', border: '#788bb9', buttonText: '#10246b' },
        }]));
      }, theme);
      await connectWithMockRos(page);
      await mockOpenAiCompatibleChat(page, { kind: 'explanation', message: 'Robot data is available. Tags are optional references.\n\n## Observations\n\n**Verified** `linear.x`\n\n- One\n- Two\n\n| Frame | Status | Measurement |\n| --- | --- | --- |\n| world | Present | 0.05 metres |\n| robot_tool_tip | Connected | 0.20 radians |\n\n```json\n{ "very_long_robot_frame_identifier": "world/arm_1/panda_link_8/tool0/diagnostic_observation" }\n```' });
      await page.getByLabel('Open Robo-Boy assistant').click();
      const panel = page.getByTestId('assistant-panel');
      await expect(panel).toHaveClass(/is-open/);
      await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Inspect the workspace');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(panel.getByText('Robot data is available. Tags are optional references.')).toBeVisible();
      const assertFits = async () => {
        expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await panel.locator('.assistant-header').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      };
      await assertFits();
      await expect(panel.getByRole('table')).toBeVisible();
      if (width === 1280) expect(await panel.locator('.assistant-markdown-table').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await panel.locator('.assistant-chat').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(panel.getByLabel('Agent mode')).toBeVisible();
      await expect(panel.getByLabel('Chat model')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Message options' })).toHaveCount(0);
      await assertFits();
      await page.screenshot({ path: testInfo.outputPath('assistant-chat.png') });
      await panel.getByRole('button', { name: 'Assistant settings', exact: true }).click();
      const settings = panel.getByRole('dialog', { name: 'Assistant settings' });
      await settings.getByText('Trusted MCP integrations', { exact: true }).click();
      await settings.getByText('Tool policies and hooks', { exact: true }).click();
      await assertFits();
      expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      for (const checkbox of await settings.locator('input[type=checkbox]:visible').all()) {
        const box = (await checkbox.boundingBox())!;
        expect(box.width).toBe(18);
        expect(box.height).toBe(18);
        expect(await checkbox.evaluate(element => element.closest('label')!.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      await settings.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: testInfo.outputPath('assistant-settings.png') });
      await panel.getByRole('button', { name: 'Chats', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await expect(panel.getByRole('region', { name: 'Chats' })).toBeVisible();
      await expect(panel.locator('#assistant-prompt')).not.toBeVisible();
      await assertFits();
      await page.screenshot({ path: testInfo.outputPath('assistant-chats.png') });
      await panel.getByRole('button', { name: 'Back to conversation', exact: true }).click();
      await expect(panel.locator('#assistant-prompt')).toBeVisible();
    });
  }
}

test('expanded activity and queued messages do not displace the mobile composer', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await connectWithMockRos(page);
  let releaseReply!: () => void;
  const heldReply = new Promise<void>(resolve => { releaseReply = resolve; });
  await page.route('**/chat/completions', async route => {
    const isFollowUp = route.request().postDataJSON().messages.some((turn: { role: string }) => turn.role === 'tool');
    if (isFollowUp) await heldReply;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(isFollowUp
      ? { kind: 'explanation', message: 'Diagnostics inspected.' }
      : { kind: 'contextRequest', summary: 'Inspecting diagnostics.', reads: [{ kind: 'topic', name: '/diagnostics' }] }) });
  });
  try {
  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  const prompt = panel.locator('#assistant-prompt');
  await prompt.fill('Read current diagnostics');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForRosSubscription(page, '/diagnostics');
  await prompt.fill('Inspect TF next');
  await panel.getByRole('button', { name: 'Message options' }).click();
  await panel.getByLabel('Message delivery').selectOption('queue');
  await panel.getByRole('button', { name: 'Close message options' }).click();
  await expect(panel.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await panel.getByText('Pending messages (1)', { exact: true }).click();
  await panel.locator('.assistant-tool-events > summary').click();
  await page.setViewportSize({ width: 320, height: 360 });
  await expect(panel.locator('.assistant-chat')).toBeVisible();
  await expect(prompt).toBeVisible();
  expect((await panel.locator('.assistant-chat').boundingBox())!.height).toBeGreaterThan(60);
  await prompt.fill('A long follow-up\n'.repeat(20));
  await expect.poll(async () => (await panel.locator('.assistant-chat').boundingBox())!.height).toBeGreaterThan(60);
  expect(await prompt.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(panel.getByRole('button', { name: 'Stop generating', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('assistant-running-keyboard.png') });
  await panel.getByRole('button', { name: 'Stop generating', exact: true }).click();
  await expect(panel.getByLabel('Message delivery')).toHaveCount(0);
  } finally { releaseReply(); }
});

test('keeps the launcher anchored beneath the panel and reverses the animation when toggled', async ({ page }) => {
  await connectWithMockRos(page);
  const launcher = page.locator('.assistant-launcher');
  const closedBox = (await launcher.boundingBox())!;
  await launcher.click();

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
  await expect(panel).toHaveClass(/is-open/);
  await expect(async () => {
    const openBox = (await launcher.boundingBox())!;
    expect(Math.abs(openBox.x + openBox.width / 2 - closedBox.x - closedBox.width / 2)).toBeLessThan(1);
    expect(Math.abs(openBox.y + openBox.height / 2 - closedBox.y - closedBox.height / 2)).toBeLessThan(1);
  }).toPass();
  // It yields to panel controls while docked, and becomes clickable again when the frame moves.
  expect(await launcher.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(false);
  const headerBox = (await panel.locator('.assistant-header').boundingBox())!;
  await page.mouse.move(headerBox.x + 180, headerBox.y + 25);
  await page.mouse.down();
  await page.mouse.move(headerBox.x - 20, headerBox.y + 25, { steps: 5 });
  await page.mouse.up();
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

for (const viewport of [{ width: 900, height: 700 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`settings keep the full header reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await connectWithMockRos(page);
    await page.getByLabel('Open Robo-Boy assistant').click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel).toHaveClass(/is-open/);

    if (viewport.width >= 768) {
      // Shrink the desktop frame to its minimum width before opening settings.
      const handle = (await page.locator('.assistant-resize-handle.w').boundingBox())!;
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 150);
      await page.mouse.down();
      await page.mouse.move(handle.x + 65, handle.y + 150, { steps: 5 });
      await page.mouse.up();
    }

    await panel.getByRole('button', { name: 'Assistant settings' }).click();
    const settings = panel.getByRole('dialog', { name: 'Assistant settings' });
    const header = panel.locator('.assistant-header');
    const headerBox = (await header.boundingBox())!;
    const settingsBox = (await settings.boundingBox())!;
    expect(settingsBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);

    // Visibility alone misses partial occlusion. Check the buttons' complete hit areas,
    // including their lower corners where the settings overlay used to cover them.
    for (const name of ['Back to assistant', 'Close assistant']) {
      const button = panel.getByRole('button', { name, exact: true });
      expect(await button.evaluate(element => {
        const box = element.getBoundingClientRect();
        return [
          [box.left + 4, box.top + 4],
          [box.right - 4, box.bottom - 4],
        ].every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
      })).toBe(true);
    }

    await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect((await header.boundingBox())!.y).toBe(headerBox.y);
    await panel.getByRole('button', { name: 'Back to assistant' }).click();
    await expect(settings).toHaveCount(0);
    await panel.getByRole('button', { name: 'Assistant settings' }).click();
    await panel.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await expect(panel).toHaveCount(0);
  });
}

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

for (const width of [320, 390, 1280]) test(`inline mode/model/reasoning controls fit at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ provider: 'openai', model: 'gpt-6.1-sol', thinkingEffort: 'high', mode: 'edit' })));
  await connectWithMockRos(page);
  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel.getByLabel('Agent mode')).toHaveValue('edit');
  await expect(panel.getByLabel('Chat model')).toHaveValue('gpt-6.1-sol');
  await expect(panel.getByLabel('Thinking effort')).toHaveValue('high');
  for (const name of ['Agent mode', 'Chat model', 'Thinking effort']) {
    const control = panel.getByLabel(name);
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThan(name === 'Agent mode' ? 65 : 90);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.getByLabel('Agent mode').selectOption('goal');
  await expect(panel.getByLabel('Agent mode')).toHaveValue('goal');
  await page.screenshot({ path: testInfo.outputPath('assistant-inline-controls.png') });
});

test('keeps questions and stable checklist outcomes in the transcript, then supports rename/delete', async ({ page }) => {
  await connectWithMockRos(page);
  let round = 0;
  await page.route('**/chat/completions', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(round++ === 0
    ? { kind: 'tool', name: 'update_plan', input: { tasks: [{ id: 'inspect', label: 'Inspect workspace', status: 'done' }, { id: 'choice', label: 'Confirm Home target', status: 'waiting' }] } }
    : round === 2 ? { kind: 'tool', name: 'ask_user', input: { question: 'Which Home target should be prepared?' } }
    : round === 3 ? { kind: 'tool', name: 'update_plan', input: { tasks: [{ id: 'inspect', label: 'Inspect workspace', status: 'done' }, { id: 'choice', label: 'Confirm Home target', status: 'done', evidence: 'Operator chose the current measured pose.' }] } }
    : { kind: 'explanation', message: 'Target confirmed. No robot execution.' }) }));
  await page.getByLabel('Open Robo-Boy assistant').click();
  const panel = page.getByTestId('assistant-panel');
  await panel.getByRole('textbox', { name: 'Ask the assistant' }).fill('Prepare Home');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByText('Waiting for approval/input')).toBeVisible();
  await expect(panel.getByText('Which Home target should be prepared?', { exact: true })).toBeVisible();
  await panel.getByRole('textbox', { name: 'Continue the conversation' }).fill('Use current measured pose');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByText('Target confirmed. No robot execution.')).toBeVisible();
  await expect(panel.getByText('Which Home target should be prepared?', { exact: true })).toBeVisible();
  await expect(panel.locator('.assistant-task-plan')).toHaveCount(1);
  await panel.locator('.assistant-task-plan > summary').click();
  await expect(panel.locator('.assistant-task-plan .is-done')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Chats', exact: true }).click();
  await panel.getByLabel('Rename chat Prepare Home').click();
  await panel.getByLabel('Chat name').fill('Robot check');
  await panel.getByRole('button', { name: 'Save name' }).click();
  await expect(panel.getByRole('button', { name: 'Robot check Current' })).toBeVisible();
  // Resize over the chat-list overlay, where the old z-index hid the handles.
  const before = (await panel.boundingBox())!;
  const handle = (await panel.getByRole('separator', { name: 'Resize assistant from w', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y + handle.height / 2, { steps: 4 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeGreaterThan(before.width + 30);
  await panel.getByLabel('Delete chat Robot check').click();
  await panel.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(panel.getByRole('button', { name: 'New chat Current' })).toBeVisible();
  const savedChats = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('robo-boy-agent-sessions-v1:') || key.startsWith('robo-boy-assistant-conversation-v1')).map(key => localStorage.getItem(key)).join('\n'));
  expect(savedChats).toContain('New chat');
  expect(savedChats).not.toContain('Prepare Home');
});

test('computes a human-spaced TF distance through the native read tool', async ({ page }) => {
  await connectWithMockRos(page);
  let round = 0;
  await page.route('**/chat/completions', route => {
    let reply: Record<string, any> = { kind: 'contextRequest', reads: [{ kind: 'transform', sourceFrame: 'panda link 0', targetFrame: 'panda hand' }] };
    if (round++ > 0) {
      const observation = route.request().postDataJSON().messages.filter((message: any) => message.role === 'tool').pop();
      const captured = JSON.parse(observation.content).value[0].value;
      expect(captured.resolvedTarget).toBe('panda_hand');
      const { x, y, z } = captured.transform.translation;
      reply = { kind: 'explanation', message: `The distance is ${Math.hypot(x, y, z).toFixed(1)} m. Path: ${captured.transform.path.join(' → ')}.` };
    }
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(reply) });
  });
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

test('hiding the assistant does not abort inference and reopening shows its completed answer', async ({ page }) => {
  await connectWithMockRos(page);
  let release!: () => void;
  let received = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/chat/completions', async route => {
    received = true;
    await held;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream({ kind: 'explanation', message: '**Completed** while hidden.' }) });
  });
  try {
    await page.getByLabel('Open Robo-Boy assistant').click();
    await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Inspect in the background');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => received).toBe(true);
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await expect(page.getByTestId('assistant-panel')).toHaveCount(0);
    release();
    await page.getByLabel('Open Robo-Boy assistant').click();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.assistant-message.user')).toHaveCount(1);
  } finally { release(); }
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

  // The composer and header controls are all frequent touch targets, while the single-line header
  // keeps their full hit area without spending another row of vertical space.
  const composerControls = await panel.locator('.assistant-speech-toolbar button:visible').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect())
  );
  expect(composerControls.length).toBeGreaterThan(0);
  expect(composerControls.every(box => box.width >= 44 && box.height >= 44)).toBe(true);

  const headerControls = await panel.locator('.assistant-header button:visible').evaluateAll(buttons =>
    buttons.map(button => button.getBoundingClientRect())
  );
  expect(headerControls.every(box => box.width >= 44 && box.height >= 44)).toBe(true);
  const headerHeight = (await panel.locator('.assistant-header').boundingBox())!.height;
  expect(headerHeight).toBeLessThanOrEqual(46);
});

test('mobile assistant docks into the workspace, restores its launcher, and landscape uses a side panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await connectWithMockRos(page);
  const launcher = page.locator('.assistant-launcher');
  const workspace = page.locator('.desktop-workspace');
  const workspaceBefore = (await workspace.boundingBox())!;
  await launcher.click();
  const mobilePanel = page.getByTestId('assistant-panel');
  await expect(mobilePanel).toBeVisible();
  await expect(mobilePanel.getByRole('textbox', { name: 'Ask the assistant' })).not.toBeFocused();
  await expect(launcher).toBeHidden();
  await expect(launcher).toHaveAttribute('aria-hidden', 'true');
  await expect(async () => {
    const panelBox = (await mobilePanel.boundingBox())!;
    const workspaceAfter = (await workspace.boundingBox())!;
    expect(panelBox.y).toBeGreaterThan(250);
    expect(workspaceAfter.height).toBeLessThan(workspaceBefore.height - 400);
    expect(workspaceAfter.y + workspaceAfter.height - panelBox.y).toBeGreaterThanOrEqual(8);
    expect(workspaceAfter.y + workspaceAfter.height - panelBox.y).toBeLessThanOrEqual(20);
  }).toPass();

  await expect(mobilePanel).toHaveClass(/is-open/);
  const initialPanelBox = (await mobilePanel.boundingBox())!;
  const headerBox = (await mobilePanel.locator('.assistant-header').boundingBox())!;
  await page.mouse.move(headerBox.x + 90, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + 90, headerBox.y - 100, { steps: 6 });
  await page.mouse.up();
  await expect(async () => {
    const resizedPanel = (await mobilePanel.boundingBox())!;
    const resizedWorkspace = (await workspace.boundingBox())!;
    expect(resizedPanel.height).toBeGreaterThan(initialPanelBox.height + 80);
    expect(resizedWorkspace.y + resizedWorkspace.height - resizedPanel.y).toBeGreaterThanOrEqual(8);
    expect(resizedWorkspace.y + resizedWorkspace.height - resizedPanel.y).toBeLessThanOrEqual(20);
  }).toPass();

  await mobilePanel.getByRole('button', { name: 'Assistant settings' }).click();
  const settings = mobilePanel.getByRole('dialog', { name: 'Assistant settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Connection' })).toBeVisible();
  await expect(settings.getByRole('heading', { name: 'Voice' })).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Close assistant settings' })).toHaveCount(0);
  await mobilePanel.getByRole('button', { name: 'Back to assistant' }).click();
  await expect(settings).toHaveCount(0);

  await page.goBack();
  await expect(mobilePanel).toHaveCount(0);
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute('aria-label', 'Open Robo-Boy assistant');
  await expect(async () => expect((await workspace.boundingBox())!.height).toBeGreaterThan(workspaceBefore.height - 6)).toPass();

  await page.setViewportSize({ width: 844, height: 390 });
  await launcher.click();
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
