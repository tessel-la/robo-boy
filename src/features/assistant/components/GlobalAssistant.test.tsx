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
  fetchedAt: Date.now(),
};

describe('GlobalAssistant', () => {
  beforeEach(() => {
    localStorage.clear();
    sendAssistantChatMock.mockReset();
  });

  it('renders a launcher and opens a non-modal panel that does not cover the app with a click-blocking backdrop', () => {
    render(<GlobalAssistant ros={null} isConnected={false} connectionGeneration={0} workspace={workspace} />);

    const launcher = screen.getByLabelText('Open Robo-Boy assistant');
    fireEvent.click(launcher);

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
    render(<GlobalAssistant ros={null} isConnected={false} connectionGeneration={0} workspace={workspace} />);
    fireEvent.click(screen.getByLabelText('Open Robo-Boy assistant'));
    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument();
  });

  it('sends a message, requires no ROS connection for a plain explanation, and renders the response', async () => {
    sendAssistantChatMock.mockResolvedValue(JSON.stringify({ kind: 'explanation', message: 'Robo-Boy has no connected robot right now.' }));

    render(<GlobalAssistant ros={null} isConnected={false} connectionGeneration={0} workspace={workspace} />);
    fireEvent.click(screen.getByLabelText('Open Robo-Boy assistant'));

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
    // Pinning the BT panel surfaces its current tree as a context chip, not a separate panel.
    expect(screen.getByText('BT: My Tree')).toBeInTheDocument();

    // Opening again (as a second contextual button click would do) must not reset the
    // conversation or create a second panel instance.
    act(() => ref.current?.open({ pinBehaviorTreePanelId: 'tile-1' }));
    expect(screen.getAllByTestId('assistant-panel')).toHaveLength(1);
  });
});
