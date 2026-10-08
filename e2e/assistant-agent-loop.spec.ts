import { expect, test } from '@playwright/test';
import { installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';
import { assistantStream } from './helpers/assistantMock';

const action = '/arm_1/panda_arm_controller/follow_joint_trajectory';
const type = 'control_msgs/action/FollowJointTrajectory';
const typedef = (name: string, fields: string[], types: string[], lengths: number[]) => ({ type: name, fieldnames: fields, fieldtypes: types, fieldarraylen: lengths, examples: fields.map(() => ''), constnames: [], constvalues: [] });

for (const kind of ['pad', 'behaviorTree'] as const) for (const mobile of [false, true]) test(`native save_document stages ${kind} for review, not silent saving (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page, { topics: [], services: [], actionServers: [] });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.getByRole('status', { name: /^Connected to / })).toHaveCount(0);
  if (kind === 'behaviorTree') {
    await page.getByLabel('Add workspace panel').first().click();
    await page.getByRole('button', { name: 'Behavior tree', exact: true }).click();
    await expect(page.getByTestId('behavior-tree-panel')).toBeVisible();
  }
  const id = `review-${kind}`;
  const document = kind === 'pad'
    ? { id, name: 'Review Pad', gridSize: { width: 4, height: 2 }, cellSize: 80, components: [{ id: 'readout', type: 'button', label: 'Unbound', position: { x: 0, y: 0, width: 1, height: 1 } }] }
    : { id, name: 'Review Tree', nodes: [{ id: 'root', type: 'sequence', position: { x: 0, y: 0 }, data: { type: 'sequence', label: 'Review sequence' } }], edges: [], createdAt: Date.now(), updatedAt: Date.now() };
  const receipts: unknown[] = [];
  let round = 0;
  await page.route('**/chat/completions', async route => {
    receipts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(round++ === 0
      ? { kind: 'tool', name: 'save_document', input: { kind, document } }
      : round === 2 ? { kind: 'tool', name: 'read_document', input: { kind, id: `proposal:${id}` } }
      : { kind: 'explanation', message: 'The draft is awaiting operator review; it is not saved.' }) });
  });
  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill(`Create a ${kind} for review.`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('The draft is awaiting operator review; it is not saved.')).toBeVisible();
  expect(JSON.stringify(receipts)).toContain('awaiting-review');
  const saved = () => page.evaluate(({ kind, id }) => {
    const store = JSON.parse(localStorage.getItem(kind === 'pad' ? 'robo-boy-custom-gamepads' : 'robo-boy-behavior-trees') ?? 'null');
    return kind === 'pad' ? Boolean(store?.customLayouts?.some((item: any) => item.layout.id === id)) : Boolean(store?.some((item: any) => item.tree.id === id));
  }, { kind, id });
  expect(await saved()).toBe(false);
  if (kind === 'pad') {
    await expect(page.getByRole('button', { name: 'Review in Pad editor' })).toBeVisible();
    await page.getByRole('button', { name: 'Reject Pad proposal' }).click();
    await expect(page.getByText('Proposal rejected. No authoring changes were saved.')).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await expect(page.getByTestId('bt-agent-canvas-preview-banner').getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    await page.getByTestId('bt-agent-canvas-preview-banner').getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByTestId('bt-agent-canvas-preview-banner')).toHaveCount(0);
  }
  expect(await saved()).toBe(false);
  // A rejected draft can be proposed again; only acceptance in its owner changes the document.
  round = 0;
  if (kind === 'behaviorTree') await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Continue the conversation' }).fill('Propose it again so I can accept in the editor.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('The draft is awaiting operator review; it is not saved.').last()).toBeVisible();
  if (kind === 'pad') {
    await page.getByRole('button', { name: 'Review in Pad editor' }).click();
    await expect(page.getByRole('heading', { name: 'Gamepad Editor' })).toBeVisible();
    expect(await saved()).toBe(false);
    await page.getByRole('button', { name: 'Save Gamepad', exact: true }).click();
    expect(await saved()).toBe(true);
  } else {
    await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
    await page.getByTestId('bt-agent-canvas-preview-banner').getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(page.getByTestId('bt-agent-canvas-preview-banner')).toHaveCount(0);
    await expect(page.getByTestId('bt-canvas').getByText('Review sequence', { exact: true })).toBeVisible();
    // Acceptance updates the existing editor draft; saving to the library and Run are separate.
    expect(await saved()).toBe(false);
  }
  const commands = await page.evaluate(() => (window as any).__getRosCommands());
  expect(commands.filter((command: any) => {
    if (command.op === 'send_action_goal') return true;
    if (command.op !== 'publish') return false;
    // The app's own inspection/status probes use publishers; those are not robot execution.
    if (command.topic === '/roboboy/inspection/request') return false;
    if (command.topic === '/robo_boy/behavior_tree/command' && JSON.parse(command.msg.data).command === 'status') return false;
    return true;
  })).toEqual([]);
});

for (const mobile of [false, true]) test(`saves and selects a new Genesis Pad in one native task (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ authoringMode: 'automatic' })));
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const topic = '/arm_1/servo_node/delta_twist_cmds';
  const messageType = 'geometry_msgs/msg/TwistStamped';
  await installRosMock(page, { topics: [{ name: topic, type: messageType }], services: [], actionServers: [] });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await expect(page.getByRole('status', { name: /^Connected to / })).toHaveCount(0);
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'Pad controls', exact: true }).click();
  const card = page.locator('[data-workspace-card-id]').filter({ has: page.locator('.workspace-pad-body') }).first();
  const panelId = (await card.getAttribute('data-workspace-card-id'))!;
  const pad = {
    id: 'genesis-xy-angular-xy', name: 'Genesis XY + Angular XY', gridSize: { width: 8, height: 4 }, cellSize: 80,
    rosConfig: { defaultTopic: topic, defaultMessageType: messageType },
    metadata: { created: new Date().toISOString(), modified: new Date().toISOString(), version: '1.0.0' },
    components: [
      { id: 'linear', type: 'joystick', label: 'X/Y translation', position: { x: 0, y: 1, width: 3, height: 3 }, action: { topic, messageType }, config: { axes: ['linear.x', 'linear.y'], min: -0.05, max: 0.05 } },
      { id: 'angular', type: 'joystick', label: 'X/Y rotation', position: { x: 5, y: 1, width: 3, height: 3 }, action: { topic, messageType }, config: { axes: ['angular.x', 'angular.y'], min: -0.2, max: 0.2 } },
    ],
  };
  let round = 0;
  await page.route('**/chat/completions', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(round++ === 0
    ? { kind: 'tool', name: 'save_document', input: { kind: 'pad', document: pad } }
    : round === 2 ? { kind: 'workspaceEdit', operations: [{ op: 'setPanelPad', panelId, padId: pad.id }] }
    : { kind: 'explanation', message: 'The saved Genesis Pad is visible in the panel.' }) }));
  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Create a Genesis Pad with XY translation and XY rotation joysticks and show it.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('The saved Genesis Pad is visible in the panel.')).toBeVisible();
  await expect(page.getByText(`No saved Pad with id "${pad.id}".`)).toHaveCount(0);
  expect(round).toBe(3);
  await page.getByRole('button', { name: 'Close assistant', exact: true }).click();
  await expect(card.getByText('X/Y translation', { exact: true })).toBeVisible();
  await expect(card.getByText('X/Y rotation', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Pad settings' }).click();
  await expect(page.getByRole('combobox', { name: 'Pad layout' })).toHaveValue(pad.id);
  await page.getByRole('button', { name: 'Close pad settings' }).click();
  const commands = await page.evaluate(() => (window as any).__getRosCommands());
  expect(commands.filter((command: any) => command.op === 'publish' && command.topic === topic || command.op === 'send_action_goal')).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('genesis-pad-selected.png') });
});

for (const automatic of [false, true]) for (const mobile of [false, true]) test(`autonomously captures Home and ${automatic ? 'saves' : 'prepares'} an executable Pad goal (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  if (automatic) await page.addInitScript(() => localStorage.setItem('robo-boy-assistant-settings', JSON.stringify({ authoringMode: 'automatic' })));
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page, {
    topics: [{ name: '/joint_states', type: 'sensor_msgs/msg/JointState' }],
    services: [], actionServers: [{ name: action, type }], parameters: { '/arm_1/panda_arm_controller/joints': ['panda_joint1', 'panda_joint2'] },
    schemas: { [type]: [
      typedef(`${type}_Goal`, ['trajectory'], ['trajectory_msgs/msg/JointTrajectory'], [-1]),
      typedef('trajectory_msgs/msg/JointTrajectory', ['joint_names', 'points'], ['string', 'trajectory_msgs/msg/JointTrajectoryPoint'], [0, 0]),
      typedef('trajectory_msgs/msg/JointTrajectoryPoint', ['positions', 'time_from_start'], ['float64', 'builtin_interfaces/msg/Duration'], [0, -1]),
      typedef('builtin_interfaces/msg/Duration', ['sec', 'nanosec'], ['int32', 'uint32'], [-1, -1]),
    ] },
  });
  let round = 0;
  const requests: Array<{ systemPrompt: string; messages: unknown[] }> = [];
  await page.route('**/chat/completions', async route => {
    const body = route.request().postDataJSON();
    requests.push({ systemPrompt: body.messages[0].content, messages: body.messages.slice(1) });
    let reply: Record<string, any> = round++ === 0
      ? { kind: 'contextRequest', summary: 'Capturing the current joint pose and action interface.', reads: [{ kind: 'topic', name: '/joint_states' }, { kind: 'schema', resource: 'action', name: action }, { kind: 'parameter', name: '/arm_1/panda_arm_controller/joints' }] }
      : round === 2 ? {
          kind: 'padProposal',
          layout: {
            id: 'home-pad', name: 'Captured Home', gridSize: { width: 4, height: 2 }, cellSize: 80,
            components: [{
              id: 'home', type: 'button', label: 'Home', position: { x: 0, y: 0, width: 2, height: 2 },
              eventOperations: {
                press: {
                  kind: 'action', name: action, messageType: type,
                  payload: { trajectory: { joint_names: ['panda_joint1', 'panda_joint2'], points: [{ positions: [0.25, -0.75], time_from_start: { sec: 10, nanosec: 0 } }] } },
                },
              },
            }],
          },
        } : { kind: 'explanation', message: automatic ? 'Home is saved; controls and robot motion remain operator-owned.' : 'Home is ready for review.' };
    if (automatic && reply.kind === 'padProposal') reply = { kind: 'tool', name: 'save_document', input: { kind: 'pad', document: reply.layout } };
    else if (automatic && round === 3) reply = { kind: 'tool', name: 'read_document', input: { kind: 'pad', id: 'home-pad' } };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: assistantStream(reply, 'I will read the robot data before proposing a goal.') });
  });
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible();
  await page.getByLabel('Open Robo-Boy assistant').click();
  await page.getByRole('textbox', { name: 'Ask the assistant' }).fill('Use current joint pose as Home and add a button to the pad');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await waitForRosSubscription(page, '/joint_states');
  await publishRosMessage(page, '/joint_states', { name: ['panda_joint1', 'panda_joint2'], position: [0.25, -0.75] });
  if (automatic) {
    await expect(page.getByText('Home is saved; controls and robot motion remain operator-owned.')).toBeVisible();
    await page.getByTestId('assistant-panel').getByText('Changes (1)', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Review in Pad editor' })).toBeVisible();
    await expect(page.getByText('Home is ready for review.')).toBeVisible();
  }
  expect(requests).toHaveLength(automatic ? 4 : 3);
  expect(requests[0].systemPrompt).toContain('### Live ROS graph');
  expect(requests[0].systemPrompt).toContain('"name":"/joint_states"');
  expect(requests[1].messages.filter((turn: any) => turn.role === 'user')).toEqual(requests[0].messages.filter((turn: any) => turn.role === 'user'));
  expect(JSON.stringify(requests[1].messages)).toContain('tool_call_id');
  expect(requests[1].systemPrompt).toContain('"position":[0.25,-0.75]');
  expect(requests[1].systemPrompt).toContain('time_from_start');
  await page.getByTestId('assistant-panel').getByText('Thinking', { exact: true }).click();
  await expect(page.getByText(/I will read the robot data/)).toBeVisible();
  await expect(page.locator('.assistant-message.user')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('home-proposal.png') });
  // Robot motion stays in the reviewed Pad workflow, never in assistant retrieval.
  if (!automatic) {
    await page.getByRole('button', { name: 'Review in Pad editor' }).click();
    await expect(page.getByRole('heading', { name: 'Gamepad Editor' })).toBeVisible();
    await page.getByRole('button', { name: 'Save Gamepad', exact: true }).click();
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-custom-gamepads') ?? '{}').customLayouts.find((item: { id: string }) => item.id === 'home-pad').layout);
  expect(saved.components[0].eventOperations.press).toMatchObject({
    name: action, messageType: type,
    payload: { trajectory: { joint_names: ['panda_joint1', 'panda_joint2'], points: [{ positions: [0.25, -0.75], time_from_start: { sec: 10, nanosec: 0 } }] } },
  });
  const robotCalls = await page.evaluate(() => (window as any).__getRosCommands().filter((command: any) => command.op === 'send_action_goal' || command.op === 'call_service' && !command.service.startsWith('/rosapi/')));
  expect(robotCalls).toEqual([]);
  if (automatic) {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-custom-gamepads') ?? '{}').customLayouts.some((item: { id: string }) => item.id === 'home-pad'))).toBe(false);
  }
});
