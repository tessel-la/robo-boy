import { expect, test } from '@playwright/test';
import { installRosMock, publishRosMessage, waitForRosSubscription } from './helpers/rosMock';

const action = '/arm_1/panda_arm_controller/follow_joint_trajectory';
const type = 'control_msgs/action/FollowJointTrajectory';
const typedef = (name: string, fields: string[], types: string[], lengths: number[]) => ({ type: name, fieldnames: fields, fieldtypes: types, fieldarraylen: lengths, examples: fields.map(() => ''), constnames: [], constvalues: [] });

for (const mobile of [false, true]) test(`autonomously captures Home and prepares an executable Pad goal (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await installRosMock(page, {
    topics: [{ name: '/joint_states', type: 'sensor_msgs/msg/JointState' }],
    services: [], actionServers: [{ name: action, type }],
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
    const reply = round++ === 0
      ? { kind: 'contextRequest', summary: 'Capturing the current joint pose and action interface.', reads: [{ kind: 'topic', name: '/joint_states' }, { kind: 'schema', resource: 'action', name: action }] }
      : {
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
        };
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'I will read the robot data before proposing a goal.' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(reply) } }] })}\n\ndata: [DONE]\n\n` });
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
  await expect(page.getByRole('button', { name: 'Review in Pad editor' })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].systemPrompt).toContain('### Live ROS graph');
  expect(requests[0].systemPrompt).toContain('"name":"/joint_states"');
  expect(requests[1].messages).toEqual(requests[0].messages);
  expect(requests[1].systemPrompt).toContain('"position":[0.25,-0.75]');
  expect(requests[1].systemPrompt).toContain('time_from_start');
  await page.getByTestId('assistant-panel').getByText('Thinking', { exact: true }).click();
  await expect(page.getByText(/I will read the robot data/)).toBeVisible();
  await expect(page.locator('.assistant-message.user')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('home-proposal.png') });
  // Robot motion stays in the reviewed Pad workflow, never in assistant retrieval.
  await page.getByRole('button', { name: 'Review in Pad editor' }).click();
  await expect(page.getByRole('heading', { name: 'Gamepad Editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Save Gamepad', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('robo-boy-custom-gamepads') ?? '{}').customLayouts.find((item: { id: string }) => item.id === 'home-pad').layout);
  expect(saved.components[0].eventOperations.press).toMatchObject({
    name: action, messageType: type,
    payload: { trajectory: { joint_names: ['panda_joint1', 'panda_joint2'], points: [{ positions: [0.25, -0.75], time_from_start: { sec: 10, nanosec: 0 } }] } },
  });
});
