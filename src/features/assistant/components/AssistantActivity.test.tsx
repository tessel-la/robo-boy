import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantActivity } from './AssistantActivity';
import type { AgentEvent } from '../runtime/session';

describe('assistant activity presentation', () => {
  it('omits empty activity', () => {
    const { container } = render(<AssistantActivity events={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows current work without expanding all results and keeps details individually expandable', () => {
    const events: AgentEvent[] = [
      {
        id: 'read',
        runId: 'run',
        at: 1,
        type: 'tool',
        label: 'read_schema',
        status: 'done',
        detail: 'Observed interface',
      },
      { id: 'child', runId: 'run', at: 2, type: 'child', label: 'Inspect TF', status: 'running' },
      { id: 'fail', runId: 'run', at: 3, type: 'tool', label: 'read_topic', status: 'failed' },
      { id: 'cancel', runId: 'run', at: 4, type: 'tool', label: 'read_logs', status: 'cancelled' },
    ];
    render(<AssistantActivity events={events} />);
    expect(screen.getByText('Running: Inspect TF')).toBeVisible();
    expect(screen.getByText('Observed interface')).not.toBeVisible();
    fireEvent.click(screen.getByText('Agent activity (4)'));
    expect(screen.getByText('Investigation: Inspect TF')).toBeVisible();
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByText('Canceled')).toBeVisible();
    fireEvent.click(screen.getByText('read schema'));
    expect(screen.getByText('Observed interface')).toBeVisible();
    expect(screen.getByText('Observed interface')).toHaveAttribute('tabindex', '0');
  });

  it('distinguishes paused activity without displaying it as a user message', () => {
    render(
      <AssistantActivity
        events={[{ id: 'paused', runId: 'run', at: 1, type: 'tool', label: 'read_topic', status: 'paused' }]}
      />
    );
    expect(screen.getByText('Paused: read topic')).toBeVisible();
  });
});
