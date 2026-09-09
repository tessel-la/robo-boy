import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendAssistantChatMock = vi.hoisted(() => vi.fn());
vi.mock('../providers/index', async importOriginal => {
  const actual = await importOriginal<typeof import('../providers/index')>();
  return { ...actual, sendAssistantChat: sendAssistantChatMock };
});

import GlobalAssistant, { type GlobalAssistantHandle } from './GlobalAssistant';
import type { WorkspaceSnapshot } from '../types';

const workspace: WorkspaceSnapshot = {
  connectionStatus: 'connected',
  openPanels: [{ id: 'p1', type: 'camera', title: 'Camera' }],
  selectedPadLayoutId: null,
  openBehaviorTreeId: null,
  savedLayouts: [{ id: 'l1', title: 'Field setup', panels: [] }],
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

  it('opens as a desktop complementary panel through its application-toolbar handle', () => {
    renderOpenAssistant();

    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();
    // Non-modal (WAI-ARIA dialog pattern, plan §2): no aria-modal attribute, and no full-page
    // click-outside-to-close handler that would swallow clicks meant for the rest of the app
    // (unlike the old BT-agent's `.bt-agent-overlay` onPointerDown-closes-on-outside-click).
    // Pointer-events:none on `.assistant-overlay` (see AssistantPanel.css) is the CSS half of
    // this; jsdom does not apply imported stylesheets, so it isn't asserted here.
    expect(screen.getByTestId('assistant-panel')).not.toHaveAttribute('aria-modal');
    expect(document.querySelector('.assistant-overlay')).toBeTruthy();
  });

  it('closes on Escape', () => {
    renderOpenAssistant();
    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument();
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

  it('shows the context browser as named sections instead of one flat list', () => {
    renderOpenAssistant();
    fireEvent.click(screen.getByRole('button', { name: /Context/ }));
    expect(screen.getByRole('dialog', { name: 'Add context' })).toBeInTheDocument();
    expect(screen.getByText('Current workspace')).toBeInTheDocument();
    expect(screen.getByText('Pads')).toBeInTheDocument();
    expect(screen.getByText('Behavior Trees')).toBeInTheDocument();
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
    expect(sentTag).toHaveClass('source-workspace');
  });

  it('tags the prompt from the context browser too, instead of a separate chip strip', async () => {
    renderOpenAssistant();
    const textarea = screen.getByRole('textbox', { name: 'Ask the assistant' });
    fireEvent.change(textarea, { target: { value: 'look here' } });
    fireEvent.click(screen.getByRole('button', { name: /Context/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Camera/ }));

    await waitFor(() => expect(textarea).toHaveValue('look here @Camera '));
    expect(screen.queryByLabelText('Remove Panel: Camera from context')).not.toBeInTheDocument();
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
