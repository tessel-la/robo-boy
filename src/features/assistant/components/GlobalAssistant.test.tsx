import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendAssistantChatMock = vi.hoisted(() => vi.fn());
vi.mock('../providers/index', async importOriginal => {
  const actual = await importOriginal<typeof import('../providers/index')>();
  return { ...actual, sendAssistantChat: sendAssistantChatMock };
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

import GlobalAssistant, { type GlobalAssistantHandle } from './GlobalAssistant';
import { resolveCompactAssistantFrame } from './mobileAssistantLayout';
import type { WorkspaceSnapshot } from '../types';

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

  it('docks on a tall phone and takes over short or keyboard-reduced viewports', () => {
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 844, viewportWidth: 390, toolbarBottom: 40 }))
      .toEqual({ top: 313.36, height: 530.64, workspaceInset: 530.64, takeover: false });
    expect(resolveCompactAssistantFrame({ viewportTop: 0, viewportHeight: 568, viewportWidth: 320, toolbarBottom: 40 }))
      .toEqual({ top: 40, height: 528, workspaceInset: 0, takeover: true });
  });

  it('asks rosapi only for Pad-bindable topic types on a Pad turn, never the whole graph', async () => {
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
    expect(askedTypes).toEqual(['geometry_msgs/msg/Twist', 'sensor_msgs/msg/Joy']);
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
    expect(sendAssistantChatMock.mock.calls[0][0].systemPrompt).toContain('## Workspace tool');
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
    expect(secondRequest.messages[secondRequest.messages.length - 1]).toMatchObject({ role: 'user', content: 'Build a tree that moves the robot 0.1 m left and then right.' });
    expect(screen.getByText('Build a tree that moves the robot 0.1 m left and then right.')).toBeInTheDocument();
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
      content: 'Create a BT to move the robot',
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
    expect(screen.getByText('a better question')).toBeInTheDocument();
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




  /** Everything the app holds goes in every turn, so a question about any Pad or tree is answerable
   * without the user fetching one first. */
  it('carries every saved Pad and Behavior Tree, in full, without being asked', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Seen.' }));
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });
    fireEvent.change(textarea, { target: { value: 'what pads do I have' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Seen.')).toBeInTheDocument());
    const prompt = sendAssistantChatMock.mock.calls[0][0].systemPrompt;
    expect(prompt).toContain('### Every saved Pad, complete');
    // "Complete" means the layout itself, not a count of its parts.
    expect(prompt).toMatch(/### Every saved Pad, complete\n.*"components":\[/);
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
