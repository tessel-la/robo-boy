import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rosContext from '../context/rosContext';

const sendAssistantChatMock = vi.hoisted(() => vi.fn());
vi.mock('../providers/index', async importOriginal => {
  const actual = await importOriginal<typeof import('../providers/index')>();
  // Domain objects below are fixture specifications, not the production response protocol.
  // Simulate native tool rounds here; transport replay is tested with MockLanguageModelV4.
  return { ...actual, sendAssistantChat: async (request: import('../providers/types').SendChatRequest) => {
    let previous = '', observation: unknown;
    for (let step = 0; step < 12; step++) {
      request.beforeStep?.();
      const current = { ...request, systemPrompt: (request.refreshSystemPrompt?.() ?? request.systemPrompt), observation };
      const raw = await sendAssistantChatMock(current);
      if (!raw) return 'Tool work completed.';
      let response: Record<string, any>;
      try { response = JSON.parse(raw); } catch { return raw; }
      if (response.kind === 'tool') {
        observation = await request.tools!.execute(response.name, response.input, crypto.randomUUID());
        continue;
      }
      if (response.kind === 'explanation') return response.message;
      if (response.kind === 'clarification') return response.question;
      if (raw === previous) return response.summary || 'Tool work completed.';
      previous = raw;
      if (response.kind === 'contextRequest') {
        observation = await Promise.all(response.reads.map((read: Record<string, any>) => { const { kind, ...input } = read; return request.tools!.execute(`read_${kind}`, input, crypto.randomUUID()); }));
      } else {
        const names: Record<string, string> = { workspaceEdit: 'edit_workspace', padProposal: 'propose_pad', tree: 'propose_tree', rosAction: 'propose_operation' };
        const { kind, summary, followUp, ...input } = response;
        observation = await request.tools!.execute(names[kind], kind === 'tree' ? { tree: response } : input, crypto.randomUUID());
      }
    }
    throw new Error('Fixture exceeded native step allowance.');
  } };
});

const discoveryMock = vi.hoisted(() => ({
  discoverAllROSResources: vi.fn(),
  fetchMessageSchema: vi.fn(),
  fetchServiceRequestSchema: vi.fn(),
  fetchActionGoalDetails: vi.fn(),
}));
vi.mock('../../behaviorTree/services/rosDiscovery', async importOriginal => {
  const actual = await importOriginal<typeof import('../../behaviorTree/services/rosDiscovery')>();
  return { ...actual, ...discoveryMock };
});

const cameraMock = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../context/cameraContext', async importOriginal => {
  const actual = await importOriginal<typeof import('../context/cameraContext')>();
  return { ...actual, captureCameraFrame: cameraMock.capture };
});
import GlobalAssistant, { type GlobalAssistantHandle } from './GlobalAssistant';
import { resolveCompactAssistantFrame } from './mobileAssistantLayout';
import type { WorkspaceSnapshot } from '../types';
import type { WorkspaceEditOperation } from '../tools/workspaceTool';

const workspace: WorkspaceSnapshot = {
  connectionStatus: 'connected',
  openPanels: [{ id: 'p1', type: 'camera', title: 'Camera' }],
  selectedPadLayoutId: null,
  openBehaviorTreeId: null,
  savedLayouts: [{ id: 'l1', title: 'Field setup', panels: [] }],
  panelCatalog: [{ id: 'camera', name: 'Camera' }, { id: 'behaviorTree', name: 'Behavior tree' }],
  fetchedAt: Date.now(),
};

describe('GlobalAssistant', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    localStorage.clear();
    sendAssistantChatMock.mockReset();
  });

  const renderOpenAssistant = (props: Partial<React.ComponentProps<typeof GlobalAssistant>> = {}) => {
    const ref = createRef<GlobalAssistantHandle>();
    render(<GlobalAssistant ref={ref} ros={null} isConnected={false} connectionGeneration={0} workspace={workspace} {...props} />);
    act(() => ref.current?.open());
    return ref;
  };

  it('keeps a tool question in history after answering and completes the same run', async () => {
    sendAssistantChatMock.mockResolvedValueOnce(JSON.stringify({ kind: 'tool', name: 'ask_user', input: { question: 'Which home pose?' } })).mockResolvedValueOnce('Current pose selected.');
    renderOpenAssistant();
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Prepare Home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Which home pose?')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Continue the conversation'), { target: { value: 'Current measured pose' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Current pose selected.')).toBeVisible();
    expect(document.querySelectorAll('.assistant-message.user')).toHaveLength(2);
    expect(screen.getByText('Which home pose?')).toBeVisible();
    expect(localStorage.getItem('robo-boy-assistant-conversation-v1')).toContain('Which home pose?');
  });
  it('renames and deletes the last chat without resurrecting its legacy history', async () => {
    sendAssistantChatMock.mockResolvedValue('Done.');
    renderOpenAssistant();
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Inspect joints' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Done.');
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    fireEvent.click(screen.getByLabelText('Rename chat Inspect joints'));
    fireEvent.change(screen.getByLabelText('Chat name'), { target: { value: 'Daily check' } });
    fireEvent.click(screen.getByText('Save name'));
    expect(await screen.findByRole('button', { name: 'Daily check Current' })).toBeVisible();
    fireEvent.click(screen.getByLabelText('Delete chat Daily check'));
    fireEvent.click(screen.getByText('Delete permanently'));
    expect(await screen.findByRole('button', { name: 'New chat Current' })).toBeVisible();
    expect(localStorage.getItem('robo-boy-assistant-conversation-v1')).not.toContain('Inspect joints');
  });
  it('docks on a tall phone and takes over short or keyboard-reduced viewports', () => {
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 210, viewportWidth: 390, toolbarBottom: 48 }))
      .toEqual({ top: 48, height: 162, workspaceInset: 0, takeover: true });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 844, viewportWidth: 390, toolbarBottom: 40 }))
      .toEqual({ top: 313.36, height: 530.64, workspaceInset: 530.64, takeover: false });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 844, viewportWidth: 390, toolbarBottom: 40, requestedHeight: 650 }))
      .toEqual({ top: 194, height: 650, workspaceInset: 650, takeover: false });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 844, viewportWidth: 390, toolbarBottom: 40, requestedHeight: 200 }))
      .toEqual({ top: 482.2, height: 361.8, workspaceInset: 361.8, takeover: false });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 568, viewportWidth: 320, toolbarBottom: 40 }))
      .toEqual({ top: 40, height: 528, workspaceInset: 0, takeover: true });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 568, viewportWidth: 320, toolbarBottom: 40, requestedHeight: 360 }))
      .toEqual({ top: 208, height: 360, workspaceInset: 360, takeover: false });
  });

  it('does not introspect unrelated graph types before the model has requested an interface', async () => {
    discoveryMock.discoverAllROSResources.mockResolvedValue({
      topics: [
        { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' },
        { name: '/joy', type: 'sensor_msgs/msg/Joy' },
        { name: '/display_robot_state', type: 'moveit_msgs/msg/RobotState' },
        { name: '/connected_clients', type: 'rosbridge_msgs/msg/ConnectedClients' },
      ],
      services: [],
      actions: [],
    });
    discoveryMock.fetchMessageSchema.mockResolvedValue({ fieldnames: ['data'] });
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Pad idea.' }));
    const ros = { isConnected: true, getTopics: vi.fn(), callOnConnection: vi.fn() } as never;
    renderOpenAssistant({ ros, isConnected: true });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a new pad to move the robot left and right' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Pad idea.')).toBeInTheDocument());
    const askedTypes = discoveryMock.fetchMessageSchema.mock.calls.map(call => call[1]).sort();
    expect(askedTypes).toEqual([]);
  });

  it('reads current joints and goal schema, repairs a dead Home binding, and retains the capture for a short follow-up', async () => {
    const type = 'control_msgs/action/FollowJointTrajectory';
    discoveryMock.discoverAllROSResources.mockResolvedValue({ topics: [{ name: '/joint_states', type: 'sensor_msgs/msg/JointState' }], services: [], actions: [{ name: '/home', type, namespace: '/' }] });
    const duration = { name: 'time_from_start', rosType: 'builtin_interfaces/msg/Duration', arrayLen: -1, subfields: [{ name: 'sec', rosType: 'int32', arrayLen: -1 }, { name: 'nanosec', rosType: 'uint32', arrayLen: -1 }] };
    const points = { name: 'points', rosType: 'trajectory_msgs/msg/JointTrajectoryPoint', arrayLen: 0, subfields: [{ name: 'positions', rosType: 'float64', arrayLen: 0 }, duration] };
    discoveryMock.fetchActionGoalDetails.mockResolvedValue({ fields: [{ name: 'trajectory', rosType: 'trajectory_msgs/msg/JointTrajectory', arrayLen: -1, subfields: [{ name: 'joint_names', rosType: 'string', arrayLen: 0 }, points] }], defaults: {} });
    const sample = vi.spyOn(rosContext, 'sampleRosTopic').mockResolvedValue({ topic: '/joint_states', messageType: 'sensor_msgs/msg/JointState', samples: [{ receivedAt: Date.now(), value: { name: ['joint_verified_A'], position: [0.42] } }], timedOut: false, limits: { maxMessages: 1, maxBytesPerMessage: 24576, timeoutMs: 1800 } });
    const proposal = (seconds: number) => ({ kind: 'padProposal', layout: { name: 'Captured Home', components: [{ type: 'button', label: 'Home', eventOperations: { press: { kind: 'action', name: '/home', messageType: type, payload: { trajectory: { joint_names: ['joint_verified_A'], points: [{ positions: [0.42], time_from_start: { sec: seconds, nanosec: 0 } }] } } } } }] } });
    sendAssistantChatMock.mockImplementationOnce(async request => {
      request.onThinking?.('Reading current pose.');
      return JSON.stringify({ kind: 'contextRequest', reads: [{ kind: 'topic', name: '/joint_states' }, { kind: 'schema', resource: 'action', name: '/home' }] });
    }).mockResolvedValueOnce(JSON.stringify({ kind: 'padProposal', layout: { name: 'Captured Home', components: [{ type: 'button', action: { type: 'action', name: '/home', messageType: type }, config: {} }] } }))
      .mockResolvedValueOnce(JSON.stringify(proposal(10))).mockResolvedValueOnce('Home ready for review.').mockResolvedValueOnce(JSON.stringify(proposal(20)));
    const review = vi.fn();
    renderOpenAssistant({ ros: { isConnected: true, getTopics: vi.fn(), callOnConnection: vi.fn() } as never, isConnected: true, onReviewPadProposal: review });
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Use the current joint pose as Home and add its button to the Pad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review in Pad editor' }));
    expect(review.mock.calls[0][0].components[0].eventOperations.press.payload.trajectory.points[0].positions).toEqual([0.42]);
    expect(sample).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.assistant-message.user')).toHaveLength(1);
    fireEvent.click(await screen.findByText('Thinking', { exact: true }));
    await waitFor(() => expect(document.querySelector('.assistant-message.assistant .assistant-thinking')).toHaveTextContent('Reading current pose.'));
    expect(JSON.stringify(sendAssistantChatMock.mock.calls[2][0].observation)).toContain('no payload');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled());
    fireEvent.change(screen.getByLabelText('Continue the conversation'), { target: { value: 'Make that 20 seconds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review in Pad editor' })).toBeInTheDocument());
    const followUp = sendAssistantChatMock.mock.calls[4][0];
    expect(followUp.systemPrompt).toContain('joint_verified_A');
    expect(followUp.systemPrompt).toContain('## Authoring formats');
    expect(sample).toHaveBeenCalledOnce();
    expect(localStorage.getItem('robo-boy-assistant-conversation-v1')).not.toContain('joint_verified_A');
  });

  it('opens as a desktop complementary panel through its application-toolbar handle', () => {
    renderOpenAssistant();

    const panel = screen.getByTestId('assistant-panel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass('tree-panel-resize-frame');
    expect(document.querySelectorAll('.assistant-resize-handle.tree-panel-menu-resize-handle')).toHaveLength(4);
    // Non-modal (WAI-ARIA dialog pattern, plan §2): no aria-modal attribute, and no full-page
    // click-outside-to-close handler that would swallow clicks meant for the rest of the app
    // (unlike the old BT-agent's `.bt-agent-overlay` onPointerDown-closes-on-outside-click).
    // Pointer-events:none on `.assistant-overlay` (see AssistantPanel.css) is the CSS half of
    // this; jsdom does not apply imported stylesheets, so it isn't asserted here.
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(document.querySelector('.assistant-overlay')).toBeTruthy();
  });

  it('keeps the launcher visible and toggles closed with an exit phase', async () => {
    renderOpenAssistant();
    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();
    const launcher = screen.getByRole('button', { name: 'Close Robo-Boy assistant' });
    expect(launcher).toBeVisible();
    expect(launcher).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(launcher);
    expect(screen.getByTestId('assistant-panel')).toHaveClass('is-closing');
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open Robo-Boy assistant' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves the mobile launcher out of the composer and restores it when the sheet closes', async () => {
    const defaultMatchMedia = window.matchMedia;
    window.matchMedia = (query: string) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    });
    try {
      renderOpenAssistant();
      const launcher = document.querySelector<HTMLButtonElement>('.assistant-launcher')!;
      expect(launcher).toHaveAttribute('aria-hidden', 'true');
      expect(launcher).toHaveAttribute('tabindex', '-1');
      expect(screen.queryByRole('button', { name: 'Close Robo-Boy assistant' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close assistant' })).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Assistant settings' }));
      expect(screen.getByRole('dialog', { name: 'Assistant settings' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Close assistant settings' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Back to assistant' }));
      expect(screen.queryByRole('dialog', { name: 'Assistant settings' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Assistant settings' })).toBeVisible();

      fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
      expect(launcher).not.toHaveAttribute('aria-hidden');
      expect(launcher).not.toHaveAttribute('tabindex');
      await waitFor(() => expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument());
    } finally {
      window.matchMedia = defaultMatchMedia;
    }
  });

  it('closes on Escape after playing the exit phase', async () => {
    renderOpenAssistant();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('assistant-panel')).toHaveClass('is-closing');
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument());
  });

  it('sends a message, requires no ROS connection for a plain explanation, and renders the response', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Robo-Boy has no connected robot right now.' }));

    renderOpenAssistant();

    // Default provider (openai-compatible) needs a base URL + model, both defaulted; no API key.
    const textarea = screen.getByLabelText('Ask the assistant');
    fireEvent.change(textarea, { target: { value: 'Why can I not see a camera feed?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Robo-Boy has no connected robot right now.')).toBeInTheDocument());
    expect(sendAssistantChatMock).toHaveBeenCalledOnce();
    const request = sendAssistantChatMock.mock.calls[0][0];
    expect(request.messages[request.messages.length - 1]).toMatchObject({ role: 'user', content: 'Why can I not see a camera feed?' });
  });

  it('applies a workspace edit through the host at once and shows each outcome', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({
      kind: 'workspaceEdit',
      summary: 'Added a Behavior tree panel.',
      operations: [{ op: 'addPanel', panelType: 'behaviorTree' }, { op: 'removePanel', panelId: 'nope' }, { op: 'bogus' }],
    }));
    const onApplyWorkspaceEdit = vi.fn((operations: Array<{ op: string }>) =>
      operations.map(operation =>
        operation.op === 'addPanel'
          ? { operation: operation as never, ok: true, message: 'Added a Behavior tree panel.' }
          : { operation: operation as never, ok: false, message: 'No open panel with id "nope".' }
      )
    );
    renderOpenAssistant({ onApplyWorkspaceEdit });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'edit the layout and add the bt panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByTestId('assistant-workspace-edit-card')).toBeInTheDocument());
    expect(onApplyWorkspaceEdit).toHaveBeenCalledWith([
      { op: 'addPanel', panelType: 'behaviorTree' },
      { op: 'removePanel', panelId: 'nope' },
    ]);
    expect(screen.getByText('Applied 1 of 2 workspace changes.')).toBeInTheDocument();
    expect(screen.getByText('No open panel with id "nope".')).toBeInTheDocument();
    expect(screen.getByText('Operation 3: unknown op "bogus".')).toBeInTheDocument();
    // The tool was offered to the model because the request talks about the layout.
    expect(sendAssistantChatMock.mock.calls[0][0].systemPrompt).toContain('## Native workspace operations');
  });

  it('sends the rest of a request as the next turn once the workspace change is applied', async () => {
    sendAssistantChatMock
      .mockResolvedValueOnce(JSON.stringify({
        kind: 'workspaceEdit',
        summary: 'Added a Behavior tree panel.',
        operations: [{ op: 'addPanel', panelType: 'behaviorTree' }],
        followUp: 'Build a tree that moves the robot 0.1 m left and then right.',
      }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 'explanation', message: 'Here is the tree plan.' }));
    const onApplyWorkspaceEdit = vi.fn((operations: Array<{ op: string }>) =>
      operations.map(operation => ({ operation: operation as never, ok: true, message: 'Added a Behavior tree panel.' }))
    );
    renderOpenAssistant({ onApplyWorkspaceEdit });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a bt panel with a bt that moves the robot left and right' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Here is the tree plan.')).toBeInTheDocument());
    expect(sendAssistantChatMock).toHaveBeenCalledTimes(2);
    const secondRequest = sendAssistantChatMock.mock.calls[1][0];
    expect(secondRequest.messages.at(-1)).toMatchObject({ role: 'user', content: 'add a bt panel with a bt that moves the robot left and right' });
    expect(JSON.stringify(secondRequest.observation)).toContain('Added a Behavior tree panel.');
    expect(screen.queryByText('Build a tree that moves the robot 0.1 m left and then right.')).not.toBeInTheDocument();
  });

  it('continues an explicit second task when the model omits followUp', async () => {
    sendAssistantChatMock
      .mockResolvedValueOnce(JSON.stringify({
        kind: 'workspaceEdit',
        summary: 'Added a Behavior tree panel.',
        operations: [{ op: 'addPanel', panelType: 'behaviorTree' }],
      }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 'explanation', message: 'Built the requested tree.' }));
    const onApplyWorkspaceEdit = vi.fn((operations: Array<{ op: string }>) =>
      operations.map(operation => ({ operation: operation as never, ok: true, message: 'Added a Behavior tree panel.' }))
    );
    renderOpenAssistant({ onApplyWorkspaceEdit });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add the BT panel and create a BT to move the robot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Built the requested tree.')).toBeInTheDocument());
    expect(sendAssistantChatMock).toHaveBeenCalledTimes(2);
    expect(sendAssistantChatMock.mock.calls[1][0].messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'add the BT panel and create a BT to move the robot',
    });
  });

  it('routes configurePanel to the panel that registered a settings bridge and folds its live settings into the context', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({
      kind: 'workspaceEdit',
      summary: 'Shown.',
      operations: [
        { op: 'configurePanel', panelType: '3d', settings: { showTfFrames: ['base_link'] } },
        { op: 'configurePanel', panelId: 'nope', settings: { showTfFrames: ['base_link'] } },
      ],
    }));
    const ref = createRef<GlobalAssistantHandle>();
    render(<GlobalAssistant ref={ref} ros={null} isConnected={false} connectionGeneration={0} workspace={{ ...workspace, openPanels: [{ id: 'p3d', type: '3d', title: '3D view' }] }} />);
    const apply = vi.fn(() => [{ ok: true, message: 'Showing base_link.' }]);
    act(() => {
      ref.current?.registerPanelSettingsBridge('p3d', { panelType: '3d', settingsHelp: 'Keys: showTfFrames.', describe: () => ({ displayedTfFrames: ['world'] }), apply });
      ref.current?.open();
    });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'show base_link in the 3d view' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Showing base_link.')).toBeInTheDocument());
    expect(apply).toHaveBeenCalledWith({ showTfFrames: ['base_link'] });
    expect(screen.getByText('No open panel "nope" can be configured from here.')).toBeInTheDocument();
    const prompt = sendAssistantChatMock.mock.calls[0][0].systemPrompt as string;
    expect(prompt).toContain('"displayedTfFrames":["world"]');
    expect(prompt).toContain('Keys: showTfFrames.');
  });

  it('attaches the latest frame of the open camera, from the recording during replay, when asked what it shows', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'A person near the dock.' }));
    cameraMock.capture.mockReset();
    cameraMock.capture
      .mockResolvedValueOnce({ topic: '/front/image_raw/compressed', mimeType: 'image/jpeg', data: 'SlBFRw==', width: 640, height: 480 })
      .mockRejectedValueOnce(new Error('No image arrived on /rear within 4 s.'));
    const recording = { getTopics: (callback: (result: { topics: string[]; types: string[] }) => void) => callback({
      topics: ['/front/image_raw', '/front/image_raw/compressed', '/rear'],
      types: ['sensor_msgs/msg/Image', 'sensor_msgs/msg/CompressedImage', 'sensor_msgs/msg/Image'],
    }) };
    const ref = createRef<GlobalAssistantHandle>();
    render(<GlobalAssistant ref={ref} ros={null} visualizationRos={recording as never} isConnected={false} connectionGeneration={0}
      workspace={{ ...workspace, openPanels: [
        { id: 'cam1', type: 'camera', title: 'Front', configuration: { cameraTopic: '/front/image_raw' } },
        { id: 'cam2', type: 'camera', title: 'Rear', configuration: { cameraTopic: '/rear' } },
      ] }} />);
    act(() => ref.current?.open());
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'what do you see in the camera' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('A person near the dock.')).toBeInTheDocument());
    expect(cameraMock.capture.mock.calls.map(call => call[1].name)).toEqual(['/front/image_raw/compressed', '/rear']);
    expect(cameraMock.capture.mock.calls[0][0]).toBe(recording);
    const request = sendAssistantChatMock.mock.calls[0][0];
    const last = request.messages[request.messages.length - 1];
    expect(last.images).toEqual([{ mimeType: 'image/jpeg', data: 'SlBFRw==' }]);
    expect(last.content).toContain('latest camera frame: /front/image_raw/compressed (640×480)');
    expect(request.systemPrompt).toContain('No image arrived on /rear within 4 s.');

    sendAssistantChatMock.mockClear();
    cameraMock.capture.mockClear();
    fireEvent.change(screen.getByLabelText('Continue the conversation'), { target: { value: 'remove the camera panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalledTimes(1));
    expect(cameraMock.capture).not.toHaveBeenCalled();
  });

  it('waits for a panel that reads data before the follow-up turn, which then sees what it read', async () => {
    sendAssistantChatMock
      .mockResolvedValueOnce(JSON.stringify({
        kind: 'workspaceEdit',
        summary: 'Reading the errors.',
        operations: [
          { op: 'configurePanel', panelType: 'recordReplay', settings: { read: { topics: ['/rosout'], match: 'error' } } },
          { op: 'configurePanel', panelType: 'dataExplorer', settings: { watch: ['/scan'] } },
        ],
        followUp: 'Summarise the errors in the recording.',
      }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 'explanation', message: 'Two planner errors.' }));
    const ref = createRef<GlobalAssistantHandle>();
    render(<GlobalAssistant ref={ref} ros={null} isConnected={false} connectionGeneration={0} workspace={{ ...workspace, openPanels: [{ id: 'rr', type: 'recordReplay', title: 'Record & Replay' }, { id: 'de', type: 'dataExplorer', title: 'Data Explorer' }] }} />);
    let lastRead: unknown;
    let finishRead: () => void = () => undefined;
    act(() => {
      ref.current?.registerPanelSettingsBridge('rr', {
        panelType: 'recordReplay', settingsHelp: '', describe: () => ({ lastRead }),
        apply: () => new Promise(resolve => {
          finishRead = () => { lastRead = { matched: 2, messages: ['No path found'] }; resolve([{ ok: true, message: 'Found 2 matching messages.' }]); };
        }),
      });
      ref.current?.registerPanelSettingsBridge('de', {
        panelType: 'dataExplorer', settingsHelp: '', describe: () => ({}),
        apply: () => { throw new Error('The inspector is unavailable.'); },
      });
      ref.current?.open();
    });

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'what errors are in this rosbag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalledTimes(1));
    // The reply waits for the read rather than answering before the data exists.
    expect(screen.queryByText('Found 2 matching messages.')).not.toBeInTheDocument();
    act(() => finishRead());

    await waitFor(() => expect(screen.getByText('Two planner errors.')).toBeInTheDocument());
    expect(screen.getByText('Found 2 matching messages.')).toBeInTheDocument();
    expect(screen.getByText('✗ The inspector is unavailable.')).toBeInTheDocument();
    const followUp = sendAssistantChatMock.mock.calls[1][0];
    expect(followUp.messages.at(-1)).toMatchObject({ role: 'user', content: 'what errors are in this rosbag' });
    expect(followUp.systemPrompt).toContain('No path found');
  });

  it('waits for the newly added plot and configures it rather than an older plot', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({
      kind: 'workspaceEdit', summary: 'Joint positions configured.', operations: [
        { op: 'addPanel', panelType: 'timeSeries' },
        { op: 'configurePanel', panelType: 'timeSeries', settings: { addSignals: [{ topic: '/joint_states', messageType: 'sensor_msgs/msg/JointState', fieldPath: 'position[0]' }] } },
        { op: 'saveLayout', title: 'Joint plot' },
      ],
    }));
    const host = vi.fn((operations: WorkspaceEditOperation[]) => operations.map(operation => ({ operation, ok: true, panelId: 'new-plot', message: 'Added plot.' })));
    const ref = renderOpenAssistant({ onApplyWorkspaceEdit: host, workspace: { ...workspace, panelCatalog: [{ id: 'timeSeries', name: 'Time Series' }] } });
    const oldApply = vi.fn(), apply = vi.fn(() => [{ ok: true, message: 'Added joint position.' }]);
    act(() => ref.current?.registerPanelSettingsBridge('old-plot', { panelType: 'timeSeries', settingsHelp: '', describe: () => ({}), apply: oldApply }));
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a time series panel with joint states' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(host).toHaveBeenCalledOnce());
    expect(apply).not.toHaveBeenCalled();
    act(() => ref.current?.registerPanelSettingsBridge('new-plot', { panelType: 'timeSeries', settingsHelp: '', describe: () => ({}), apply }));
    await waitFor(() => expect(screen.getByText('Added joint position.')).toBeInTheDocument());
    expect(apply).toHaveBeenCalledWith({ addSignals: [{ topic: '/joint_states', messageType: 'sensor_msgs/msg/JointState', fieldPath: 'position[0]' }] });
    expect(oldApply).not.toHaveBeenCalled();
    expect(host).toHaveBeenCalledOnce();
    expect(screen.getByText('Ask again to save once the changes above are on screen.')).toBeInTheDocument();
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalledTimes(2));
    // Retrying the model must not repeat the already-successful panel mutation.
    expect(host).toHaveBeenCalledOnce();
  });

  it('continues settings waiting on a new panel when the assistant is hidden', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'workspaceEdit', operations: [
      { op: 'addPanel', panelType: 'timeSeries' },
      { op: 'configurePanel', panelType: 'timeSeries', settings: { paused: true } },
    ] }));
    const host = vi.fn((operations: WorkspaceEditOperation[]) => operations.map(operation => ({ operation, ok: true, panelId: 'new-plot', message: 'Added plot.' })));
    const ref = renderOpenAssistant({ onApplyWorkspaceEdit: host, workspace: { ...workspace, panelCatalog: [{ id: 'timeSeries', name: 'Time Series' }] } });
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a time series panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(host).toHaveBeenCalledOnce());
    fireEvent.keyDown(window, { key: 'Escape' });
    const apply = vi.fn();
    act(() => ref.current?.registerPanelSettingsBridge('new-plot', { panelType: 'timeSeries', settingsHelp: '', describe: () => ({}), apply }));
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument());
    await waitFor(() => expect(apply).toHaveBeenCalledOnce());
  });

  it('keeps a model turn running while hidden and shows its completed answer on reopening', async () => {
    let finish!: (answer: string) => void;
    sendAssistantChatMock.mockImplementationOnce(request => new Promise<string>(resolve => { finish = resolve; request.onThinking?.('Inspecting the requested data.'); }));
    renderOpenAssistant();
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Inspect my workspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalledOnce());
    const signal = sendAssistantChatMock.mock.calls[0][0].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }));
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument());
    expect(signal.aborted).toBe(false);
    await act(async () => finish('Inspection completed while the panel was hidden.'));
    fireEvent.click(screen.getByLabelText('Open Robo-Boy assistant'));
    expect(await screen.findByText('Inspection completed while the panel was hidden.')).toBeVisible();
    expect(screen.getByText('Thinking')).toBeInTheDocument();
  });

  it('preserves partial assistant output and thinking when a provider fails', async () => {
    sendAssistantChatMock.mockImplementationOnce(async request => { request.onThinking?.('Inspecting interfaces.'); request.onToken?.('Partial analysis.'); throw new Error('Host tool read_node timed out.'); });
    renderOpenAssistant();
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Inspect controller state' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(document.querySelector('.assistant-message.assistant')).toHaveTextContent('Partial analysis.'));
    expect(document.querySelector('.assistant-message.assistant')).toHaveTextContent('Host tool read_node timed out.');
    fireEvent.click(screen.getByText('Thinking'));
    expect(screen.getByText('Inspecting interfaces.')).toBeVisible();
    expect(document.querySelector('.assistant-message.user')).not.toHaveTextContent('Inspecting interfaces.');
  });
  it('coalesces token bursts without losing final answer or thinking', async () => {
    let finish!: (value: string) => void;
    sendAssistantChatMock.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    renderOpenAssistant();
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'Inspect state' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalledOnce());
    const request = sendAssistantChatMock.mock.calls[0][0];
    vi.useFakeTimers();
    try {
      const baseline = vi.getTimerCount();
      act(() => {
        for (let token = 0; token < 500; token++) { request.onToken?.('part '); request.onThinking?.('evidence '); }
      });
      expect(vi.getTimerCount()).toBe(baseline + 1);
      expect(document.querySelector('[aria-label="Assistant activity"] .assistant-message-content')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(document.querySelector('[aria-label="Assistant activity"]')).toHaveTextContent('part part part');
      await act(async () => { finish('part '.repeat(500)); });
      expect(document.querySelector('.assistant-message.assistant')).toHaveTextContent('part '.repeat(500).trim());
      fireEvent.click(screen.getByText('Thinking'));
      expect(document.querySelector('.assistant-thinking')).toHaveTextContent('evidence '.repeat(500).trim());
    } finally { vi.useRealTimers(); }
  });

  it('recovers the joint-state plotting task when the model only adds the panel', async () => {
    sendAssistantChatMock.mockResolvedValueOnce(JSON.stringify({ kind: 'workspaceEdit', operations: [{ op: 'addPanel', panelType: 'timeSeries' }] }))
      .mockResolvedValueOnce(JSON.stringify({ kind: 'explanation', message: 'Plotting task continued.' }));
    renderOpenAssistant({
      workspace: { ...workspace, panelCatalog: [{ id: 'timeSeries', name: 'Time Series' }] },
      onApplyWorkspaceEdit: operations => operations.map(operation => ({ operation, ok: true, panelId: 'plot', message: 'Added plot.' })),
    });
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a timeserie panel with the joints states showing in the ui' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Plotting task continued.')).toBeInTheDocument());
    expect(JSON.stringify(sendAssistantChatMock.mock.calls[1][0].observation)).toContain('Added plot.');
    expect(sendAssistantChatMock.mock.calls[1][0].messages.at(-1).content).toContain('joints states showing in the ui');
  });

  it('tells the user when no host is mounted to edit the workspace', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'workspaceEdit', summary: '', operations: [{ op: 'addPanel', panelType: 'camera' }] }));
    renderOpenAssistant();

    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'add a camera panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('The workspace cannot be edited from here.')).toBeInTheDocument());
  });

  it('opens pinned to a Behavior Tree panel via the imperative handle without starting a second conversation', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'ok' }));
    const ref = createRef<GlobalAssistantHandle>();
    render(<GlobalAssistant ref={ref} ros={null} isConnected={false} connectionGeneration={0} workspace={workspace} />);

    const bridge = {
      panelId: 'tile-1',
      label: 'My Tree',
      getCurrentTree: () => ({ id: 't1', name: 'My Tree', nodes: [], edges: [], createdAt: 0, updatedAt: 0 }),
      getSelectedTreeContext: () => null,
      getPreviewTree: () => null,
      captureCheckpoint: () => null,
      applyPreview: vi.fn(),
      restoreCheckpoint: vi.fn(),
      notify: vi.fn(),
    };
    act(() => {
      ref.current?.registerBehaviorTreeBridge('tile-1', bridge);
      ref.current?.open({ pinBehaviorTreePanelId: 'tile-1' });
    });

    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();

    // Opening again (as a second contextual button click would do) must not reset the
    // conversation or create a second panel instance.
    act(() => ref.current?.open({ pinBehaviorTreePanelId: 'tile-1' }));
    expect(screen.getAllByTestId('assistant-panel')).toHaveLength(1);

    // The open tree reaches the model as automatic context — not as a removable chip the user
    // could switch off and then be unable to restore.
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the assistant' }), { target: { value: 'What does this tree do?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sendAssistantChatMock).toHaveBeenCalled());
    expect(sendAssistantChatMock.mock.calls[0][0].systemPrompt).toContain('My Tree');
  });

  it('keeps the composer free of automatic context chips and lists what was used under the reply', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Answer.' }));
    renderOpenAssistant();

    // Nothing is pinned by default, so the composer starts with no context pills at all.
    expect(screen.queryByLabelText(/Remove .* from context/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the assistant' }), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText('Answer.')).toBeInTheDocument());
    const disclosure = screen.getByText(/Context used \(/);
    expect(disclosure).toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(screen.getByText(/Workspace \(1 panel\)/)).toBeInTheDocument();
  });

  it('edits an earlier message in place and replays the conversation from it', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'First answer.' }));
    renderOpenAssistant();

    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the assistant' }), { target: { value: 'first question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('First answer.')).toBeInTheDocument());

    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Second answer.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

    // The original text is loaded into an editable box rather than being deleted.
    const editor = screen.getByRole('textbox', { name: 'Edit message' });
    expect(editor).toHaveValue('first question');

    fireEvent.change(editor, { target: { value: 'a better question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & resend' }));

    await waitFor(() => expect(screen.getByText('Second answer.')).toBeInTheDocument());
    expect(document.querySelector('.assistant-message.user')).toHaveTextContent('a better question');
    expect(screen.queryByText('first question')).not.toBeInTheDocument();
    expect(screen.queryByText('First answer.')).not.toBeInTheDocument();
  });

  it('sends with Enter, keeps Shift+Enter for a newline, and clears parsing progress', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Sent from the keyboard.' }));
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });

    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(sendAssistantChatMock).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Sent from the keyboard.')).toBeInTheDocument());
    expect(sendAssistantChatMock).toHaveBeenCalledOnce();
    expect(screen.queryByText('Parsing response…')).not.toBeInTheDocument();
  });

  it('does not submit Enter while an input method composition is active', () => {
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });
    fireEvent.change(textarea, { target: { value: 'composing' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(sendAssistantChatMock).not.toHaveBeenCalled();
  });


  it('keeps a mentioned resource readable in the prompt instead of repeating it as a chip', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Camera context received.' }));
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });

    fireEvent.change(textarea, { target: { value: '@Cam' } });
    const cameraOption = screen.getByRole('option', { name: /Camera/ });
    fireEvent.click(cameraOption);

    await waitFor(() => expect(textarea).toHaveValue('@Camera '));
    expect(textarea).not.toHaveValue(expect.stringContaining('_'));
    expect(screen.queryByLabelText('Remove Panel: Camera from context')).not.toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Camera context received.')).toBeInTheDocument());
    const sentTag = document.querySelector('.assistant-inline-tag');
    expect(sentTag).toHaveTextContent('@Camera');
    expect(sentTag).toHaveClass('assistant-inline-tag');
  });




  it('offers all saved documents through catalogs and native retrieval without manual tagging', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Seen.' }));
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });
    fireEvent.change(textarea, { target: { value: 'what pads do I have' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Seen.')).toBeInTheDocument());
    const prompt = sendAssistantChatMock.mock.calls[0][0].systemPrompt;
    expect(prompt).toContain('## Document catalogs');
    expect(prompt).not.toContain('### Every saved Pad, complete');
    expect(sendAssistantChatMock.mock.calls[0][0].tools.definitions).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'read_document' })]));
    // No bar to open and nothing to choose: it is all already there.
    expect(screen.queryByRole('button', { name: /^Context/ })).not.toBeInTheDocument();
  });

  it('hands the Pad editor a repaired layout whose ROS binding survived the model\'s aliases', async () => {
    const onReviewPadProposal = vi.fn();
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({
      kind: 'padProposal',
      layout: {
        name: 'Drive pad',
        components: [
          // `topicName` and a bare action `type` are the shapes models actually emit; a Pad saved
          // with them unrepaired would have no usable binding.
          { type: 'joystick', action: { topicName: '/cmd_vel', type: 'geometry_msgs/msg/Twist' } },
        ],
      },
    }));
    renderOpenAssistant({ onReviewPadProposal });

    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });
    fireEvent.change(textarea, { target: { value: 'build a drive pad' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    fireEvent.click(await screen.findByRole('button', { name: 'Review in Pad editor' }));
    expect(onReviewPadProposal).toHaveBeenCalledOnce();
    const layout = onReviewPadProposal.mock.calls[0][0];
    expect(layout.components).toHaveLength(1);
    expect(layout.components[0].action).toMatchObject({ topic: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist' });
    expect(layout.components[0].id).toBeTruthy();
    expect(screen.getByText('Opened in the Pad editor for review.')).toBeInTheDocument();
  });

  it('tags a second resource while the first is still being retrieved', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Both noted.' }));
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });

    fireEvent.change(textarea, { target: { value: '@Cam' } });
    fireEvent.click(screen.getByRole('option', { name: /Camera/ }));
    await waitFor(() => expect(textarea).toHaveValue('@Camera '));

    fireEvent.change(textarea, { target: { value: '@Camera @Field' } });
    fireEvent.click(screen.getByRole('option', { name: /Field setup/ }));
    await waitFor(() => expect(textarea).toHaveValue('@Camera @Field setup '));

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Both noted.')).toBeInTheDocument());
    expect([...document.querySelectorAll('.assistant-inline-tag')].map(node => node.textContent))
      .toEqual(['@Camera', '@Field setup']);
  });
});
