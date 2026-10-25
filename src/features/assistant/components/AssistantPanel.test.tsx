import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AssistantPanel, { type AssistantPanelProps } from './AssistantPanel';
import { getDefaultAssistantSettings } from '../storage/assistantStorage';
import type { AgentEvent } from '../runtime/session';
vi.mock('./AssistantSketchEditor', () => ({
  default: ({ onAttach, onClose }: { onAttach: (value: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Sketch attachment">
      <button onClick={() => onAttach('data:image/png;base64,AA==')}>Attach sketch</button>
      <button onClick={onClose}>Close sketch editor</button>
    </div>
  ),
}));

const event: AgentEvent = {
  id: 'read',
  runId: 'run',
  at: 1,
  type: 'tool',
  label: 'read_schema',
  status: 'done',
  detail: 'Observed the connected interface.',
};
const props = (patch: Partial<AssistantPanelProps> = {}): AssistantPanelProps => ({
  open: true,
  compact: false,
  onClose: vi.fn(),
  messages: [],
  isGenerating: false,
  progressMessages: [],
  error: '',
  onSelectSuggestion: vi.fn(),
  prompt: '',
  onPromptChange: vi.fn(),
  onSubmit: vi.fn(),
  onStop: vi.fn(),
  onNewConversation: vi.fn(),
  onRepeat: vi.fn(),
  onEditMessage: vi.fn(),
  contextPickerSections: [],
  attachments: [],
  attachmentError: '',
  onAttachFiles: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onTranscribeAudio: vi.fn(),
  settings: getDefaultAssistantSettings(),
  resolvedBaseUrl: 'http://localhost:11434/v1',
  onProviderChange: vi.fn(),
  onUpdateSettings: vi.fn(),
  ollamaModels: [],
  ollamaModelsError: '',
  isLoadingOllamaModels: false,
  onRefreshOllamaModels: vi.fn(),
  onReviewPadProposal: vi.fn(),
  onSaveBehaviorTreeProposal: vi.fn(),
  hasActiveBehaviorTreeBridge: false,
  sessions: [
    { id: 'current', title: 'Inspect TF' },
    { id: 'other', title: 'Repair Pad' },
    { id: 'archived', title: 'Old task', archived: true },
  ],
  activeSessionId: 'current',
  ...patch,
});
beforeEach(() => localStorage.clear());
describe('assistant panel hierarchy', () => {
  it('puts chats in a header view and hides background controls until returning', () => {
    const input = props({ onSwitchSession: vi.fn() });
    render(<AssistantPanel {...input} />);
    expect(screen.getByLabelText('Ask the assistant')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Chats$/ }));
    expect(screen.getByRole('region', { name: 'Chats' })).toBeVisible();
    expect(screen.getByLabelText('Ask the assistant')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Old task Archived' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show archived chats'));
    expect(screen.getByRole('button', { name: 'Old task Archived' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Repair Pad Chat' }));
    expect(input.onSwitchSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Repair Pad Chat' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Chats' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Open chat Repair Pad' }));
    expect(input.onSwitchSession).toHaveBeenCalledWith('other');
    expect(screen.getByLabelText('Ask the assistant')).toBeVisible();
  });
  it('filters chat rows rather than hiding results in a select, with a real empty state', () => {
    render(<AssistantPanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chats$/ }));
    expect(screen.getByRole('button', { name: 'Inspect TF Current' })).toHaveAttribute('aria-current', 'page');
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching chats.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Inspect TF Current' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search chats'), { target: { value: '  repair  ' } });
    expect(screen.getByRole('button', { name: 'Repair Pad Chat' })).toBeVisible();
  });
  it('renders live and completed answers and thinking with the same Markdown pipeline', async () => {
    const { container } = render(
      <AssistantPanel
        {...props({
          isGenerating: true,
          thinking: '**Verify** the interface.',
          streamedAnswer: '**Ready**\n\n| Axis | Speed |\n| --- | --- |\n| X | 0.05 |',
          messages: [
            {
              id: 'completed',
              role: 'assistant',
              content: '**Saved** `pad`.',
              createdAt: 1,
              attachments: [],
              contextChipIds: [],
              checkpoint: null,
            },
          ],
        })}
      />
    );
    expect((await screen.findByText('Ready')).tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Saved').tagName).toBe('STRONG');
    fireEvent.click(screen.getByText('Thinking…'));
    expect(screen.getByText('Verify')).toBeVisible();
    expect(container.querySelectorAll('.assistant-message.user')).toHaveLength(0);
  });
  it('shows one subview at a time and keeps settings accessible through Escape', async () => {
    render(<AssistantPanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chats$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Assistant settings$/ }));
    expect(screen.queryByRole('region', { name: 'Chats' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Assistant settings' })).toBeVisible();
    expect(screen.getByLabelText('Ask the assistant')).not.toBeVisible();
    screen.getByLabelText('Provider').focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Assistant settings' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask the assistant')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Assistant settings$/ })).toHaveFocus());
  });
  it('keeps activity, changes and queued inputs in the scrollable transcript, not the composer', () => {
    const input = props({
      isGenerating: true,
      events: [event],
      documentChanges: [{ id: 'change', label: 'Home Pad', diff: 'Changed button goal.' }],
      pendingInputs: [{ id: 'queued', text: 'Inspect TF next', delivery: 'queue' }],
      onUndoDocument: vi.fn(),
      onRemovePendingInput: vi.fn(),
    });
    const { container } = render(<AssistantPanel {...input} />);
    expect(container.querySelector('.assistant-form .assistant-tool-events')).toBeNull();
    expect(screen.getByText('Changes (1)').closest('.assistant-chat')).not.toBeNull();
    expect(screen.getAllByText('Agent activity (1)')).toHaveLength(1);
    fireEvent.click(screen.getByText('Agent activity (1)'));
    expect(screen.getByText('read schema')).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
    fireEvent.click(screen.getByText('Pending messages (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued message' }));
    expect(input.onRemovePendingInput).toHaveBeenCalledWith('queued');
    fireEvent.click(screen.getByText('Changes (1)'));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
  it('keeps Stop available while composing a steering or queued message', () => {
    const input = props({ isGenerating: true, prompt: 'New evidence' });
    render(<AssistantPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Message options' }));
    fireEvent.change(screen.getByLabelText('Message delivery'), { target: { value: 'queue' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    expect(input.onSubmit).toHaveBeenCalledWith('queue');
    fireEvent.click(screen.getByRole('button', { name: /^Stop generating$/ }));
    expect(input.onStop).toHaveBeenCalledOnce();
  });
  it('offers direct modes, model, reasoning and sketch without policy controls', () => {
    const input = props({ settings: { ...getDefaultAssistantSettings(), provider: 'openai', model: 'gpt-6.1-sol' } });
    render(<AssistantPanel {...input} />);
    expect(
      Array.from(screen.getByLabelText('Agent mode').querySelectorAll('option')).map(option => option.textContent)
    ).toEqual(['Edit', 'Goal', 'Plan', 'Ask']);
    expect(screen.getByLabelText('Chat model')).toBeVisible();
    expect(screen.getByLabelText('Thinking effort')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Agent mode'), { target: { value: 'goal' } });
    expect(input.onUpdateSettings).toHaveBeenCalledWith({ mode: 'goal' });
    expect(screen.getByRole('button', { name: 'Create sketch attachment' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Message options' })).not.toBeInTheDocument();
  });
  it('archives a selected inactive chat without opening it or forking the wrong conversation', () => {
    const input = props({ onArchiveSession: vi.fn(), onSwitchSession: vi.fn() });
    render(<AssistantPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repair Pad Chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive chat' }));
    expect(input.onArchiveSession).toHaveBeenCalledWith('other');
    expect(input.onSwitchSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Fork chat' })).toBeDisabled();
  });
  it('attaches sketches through the same bounded file path and preserves the open chat on Escape', async () => {
    const input = props();
    render(<AssistantPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create sketch attachment' }));
    await screen.findByRole('dialog', { name: 'Sketch attachment' });
    fireEvent.click(screen.getByText('Attach sketch'));
    expect(input.onAttachFiles).toHaveBeenCalledOnce();
    expect((input.onAttachFiles as ReturnType<typeof vi.fn>).mock.calls[0][0][0]).toMatchObject({
      type: 'image/png',
      size: 1,
    });
    expect(screen.queryByRole('dialog', { name: 'Sketch attachment' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create sketch attachment' }));
    await screen.findByRole('dialog', { name: 'Sketch attachment' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(input.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create sketch attachment' })).toHaveFocus();
  });
  it('shows one transient waiting status, not a repeated chat transcript', () => {
    render(
      <AssistantPanel {...props({ isGenerating: true, progressMessages: Array(5).fill('Waiting for the model…') })} />
    );
    expect(screen.getAllByText('Waiting for the model…')).toHaveLength(1);
    expect(screen.queryByText('Working…')).not.toBeInTheDocument();
  });
  it('returns focus after closing running-task delivery options', async () => {
    render(<AssistantPanel {...props({ isGenerating: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Message options' }));
    expect(screen.getByRole('dialog', { name: 'Composer options' })).toBeVisible();
    expect(screen.getByLabelText('Message delivery')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Composer options' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Message options' })).toHaveFocus());
    expect(screen.getByLabelText('Ask the assistant')).toBeVisible();
  });
  it('keeps closed context and tool lists out of copied chat text', () => {
    const { container } = render(
      <AssistantPanel
        {...props({
          messages: [
            {
              id: 'done',
              role: 'assistant',
              content: 'Done',
              attachments: [],
              contextChipIds: [],
              checkpoint: null,
              createdAt: 1,
              events: [event],
              contextUsed: [{ label: 'ROS graph', source: 'ros', ageSeconds: 1 }],
            },
          ],
        })}
      />
    );
    expect(container.querySelector('.assistant-context-used ul')).toBeNull();
    expect(container.querySelector('.assistant-tool-events ol')).toBeNull();
    fireEvent.click(screen.getByText('Context used (1)'));
    expect(screen.getByText('ROS graph')).toBeVisible();
  });
  it('shows a live checklist and retains the agent question after its answer', () => {
    const question = {
      id: 'q',
      role: 'assistant' as const,
      content: 'Which home pose?',
      attachments: [],
      contextChipIds: [],
      checkpoint: null,
      createdAt: 1,
    };
    const events: AgentEvent[] = [
      {
        ...event,
        id: 'plan',
        type: 'task',
        label: 'Task checklist',
        status: 'paused',
        tasks: [
          { id: 'open', label: 'Open BT panel', status: 'done' },
          { id: 'review', label: 'Accept or reject', status: 'waiting' },
        ],
      },
      { ...event, id: 'q', type: 'question', label: question.content, status: 'running' },
    ];
    const { rerender } = render(<AssistantPanel {...props({ isGenerating: true, messages: [question], events })} />);
    expect(screen.getByLabelText('Task checklist')).toBeVisible();
    expect(screen.getByText('Waiting for approval/input')).toBeVisible();
    expect(screen.getByText('Waiting for your answer. Reply below to continue this task.')).toBeVisible();
    expect(screen.queryByText('Waiting for the model…')).not.toBeInTheDocument();
    rerender(
      <AssistantPanel
        {...props({
          messages: [question, { ...question, id: 'answer', role: 'user', content: 'Current measured pose' }],
          events: [],
        })}
      />
    );
    expect(screen.getByText('Which home pose?')).toBeVisible();
    expect(screen.getByText('Current measured pose')).toBeVisible();
  });
  it('renames chats and requires confirmation before permanent deletion', () => {
    const input = props({ onRenameSession: vi.fn(), onDeleteSession: vi.fn() });
    render(<AssistantPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chats$/ }));
    fireEvent.click(screen.getByLabelText('Rename chat Repair Pad'));
    fireEvent.change(screen.getByLabelText('Chat name'), { target: { value: 'Pad review' } });
    fireEvent.click(screen.getByText('Save name'));
    expect(input.onRenameSession).toHaveBeenCalledWith('other', 'Pad review');
    fireEvent.click(screen.getByLabelText('Delete chat Repair Pad'));
    expect(input.onDeleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete permanently'));
    expect(input.onDeleteSession).toHaveBeenCalledWith('other');
  });
  it('does not duplicate completed activity in the live-task footer', () => {
    render(
      <AssistantPanel
        {...props({
          events: [event],
          messages: [
            {
              id: 'answer',
              role: 'assistant',
              content: 'Schema verified.',
              createdAt: 1,
              attachments: [],
              contextChipIds: [],
              checkpoint: null,
              activity: ['Old duplicate progress'],
              events: [event],
            },
          ],
        })}
      />
    );
    expect(screen.getAllByText('Agent activity (1)')).toHaveLength(1);
    expect(screen.queryByText('Tools used')).not.toBeInTheDocument();
    expect(screen.queryByText('Old duplicate progress')).not.toBeInTheDocument();
  });
  it('keeps token accounting separate from the tool timeline', () => {
    render(
      <AssistantPanel
        {...props({
          isGenerating: true,
          events: [
            event,
            { ...event, id: 'usage', type: 'usage', label: 'Model usage', detail: '100 input · 20 output tokens' },
          ],
        })}
      />
    );
    expect(screen.getByText('Agent activity (1)')).toBeInTheDocument();
    expect(screen.getByText('Model usage (1 request)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Model usage (1 request)'));
    expect(screen.getByText('100 input · 20 output tokens')).toBeVisible();
  });
  it('preserves fork/archive controls in the on-demand chat view', () => {
    const input = props({ onArchiveSession: vi.fn(), onForkSession: vi.fn() });
    render(<AssistantPanel {...input} />);
    fireEvent.click(screen.getByRole('button', { name: /^Chats$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive chat' }));
    expect(input.onArchiveSession).toHaveBeenCalledWith('current');
    fireEvent.click(screen.getByRole('button', { name: 'Fork chat' }));
    expect(input.onForkSession).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Ask the assistant')).toBeVisible();
  });
});
