import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantModelControl } from './AssistantModelControl';
import { getDefaultAssistantSettings } from '../storage/assistantStorage';

afterEach(() => vi.unstubAllGlobals());
describe('inline model selection', () => {
  it('keeps arbitrary compatible model IDs and commits on blur without duplicate Enter updates', () => {
    const onUpdate = vi.fn();
    render(
      <AssistantModelControl
        settings={getDefaultAssistantSettings()}
        ollamaModels={[]}
        disabled={false}
        onUpdate={onUpdate}
      />
    );
    const input = screen.getByLabelText('Chat model');
    input.focus();
    fireEvent.change(input, { target: { value: 'local/custom-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ model: 'local/custom-model', thinkingEffort: undefined });
  });
  it('uses the local catalog without silently replacing a missing selected model', () => {
    const onUpdate = vi.fn();
    render(
      <AssistantModelControl
        settings={{ ...getDefaultAssistantSettings(), provider: 'ollama', model: 'kept' }}
        ollamaModels={['local']}
        disabled={false}
        onUpdate={onUpdate}
      />
    );
    expect(screen.getByLabelText('Chat model')).toHaveValue('kept');
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Chat model'), { target: { value: 'local' } });
    expect(onUpdate).toHaveBeenCalledWith({ model: 'local', thinkingEffort: undefined });
  });
  it('ignores a late subscription catalog after changing provider', async () => {
    let finish!: (state: unknown) => void;
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        getState: vi.fn(
          () =>
            new Promise(resolve => {
              finish = resolve;
            })
        ),
      },
    });
    const props = {
      settings: {
        ...getDefaultAssistantSettings(),
        provider: 'openai' as const,
        authMode: 'subscription' as const,
        model: 'kept',
      },
      ollamaModels: [],
      disabled: false,
      onUpdate: vi.fn(),
    };
    const { rerender } = render(<AssistantModelControl {...props} />);
    rerender(
      <AssistantModelControl
        {...props}
        settings={{ ...props.settings, provider: 'openai-compatible', authMode: 'api-key' }}
      />
    );
    await act(async () => finish({ models: [{ id: 'stale', label: 'Stale' }], accounts: [] }));
    expect(screen.getByLabelText('Chat model').tagName).toBe('INPUT');
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });
  it('shows catalog failure while keeping the selected model and disables changes during a task', async () => {
    vi.stubGlobal('roboBoyDesktop', {
      assistant: {
        getState: vi.fn(async () => {
          throw new Error('Offline');
        }),
      },
    });
    render(
      <AssistantModelControl
        settings={{ ...getDefaultAssistantSettings(), provider: 'openai', authMode: 'subscription', model: 'kept' }}
        ollamaModels={[]}
        disabled
        onUpdate={vi.fn()}
      />
    );
    expect(await screen.findByRole('status')).toHaveTextContent('catalog unavailable');
    expect(screen.getByLabelText('Chat model')).toHaveValue('kept');
    expect(screen.getByLabelText('Chat model')).toBeDisabled();
  });
});
