import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceOpening from './WorkspaceOpening';

const URL_ = 'ws://robot.local:9090';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('WorkspaceOpening', () => {
  it('opens the workspace first, with the robot still to come', () => {
    render(<WorkspaceOpening stage="loading" target="robot.local" url={URL_} standalone />);
    expect(screen.getByRole('status', { name: 'Opening the workspace' })).toBeInTheDocument();
    expect(screen.getByText('Opening the workspace').closest('li')).toHaveClass('is-active');
    expect(screen.getByText('Connect to robot.local').closest('li')).toHaveClass('is-pending');
    expect(screen.getByText(URL_)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no robot to reach for local recordings', () => {
    render(<WorkspaceOpening stage="loading" target="Local replay" offline standalone />);
    expect(screen.getByText('Opening the workspace')).toBeInTheDocument();
    expect(screen.queryByText(/Connect to/)).not.toBeInTheDocument();
    expect(screen.queryByText('This device')).not.toBeInTheDocument();
  });

  it('counts the wait, and once it runs long says what to check and offers a way on', () => {
    const onContinue = vi.fn(), onCancel = vi.fn();
    render(<WorkspaceOpening stage="connecting" target="robot.local" url={URL_} attempt={1} onContinue={onContinue} onCancel={onCancel} />);
    expect(screen.getByText('Workspace ready').closest('li')).toHaveClass('is-done');
    expect(screen.getByText('Connecting to robot.local').closest('li')).toHaveClass('is-active');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('3 s')).toBeInTheDocument();
    expect(screen.queryByText(/hasn't answered yet/)).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText(/robot.local hasn't answered yet. Check that the ROS stack is running on robot.local/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace anyway' }));
    expect(onContinue).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to connections' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('starts counting again for a new attempt', () => {
    const { rerender } = render(<WorkspaceOpening stage="connecting" target="robot.local" attempt={1} />);
    act(() => { vi.advanceTimersByTime(9000); });
    expect(screen.getByText('9 s')).toBeInTheDocument();
    rerender(<WorkspaceOpening stage="connecting" target="robot.local" attempt={2} />);
    expect(screen.queryByText('9 s')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open workspace anyway' })).not.toBeInTheDocument();
  });

  it('says which robot did not answer and what to check, with the ways on', () => {
    const onRetry = vi.fn(), onContinue = vi.fn(), onCancel = vi.fn();
    render(<WorkspaceOpening stage="failed" target="Domain 3" url="wss://base.example/websocket" attempt={1}
      onRetry={onRetry} onContinue={onContinue} onCancel={onCancel} />);
    expect(screen.getByRole('status', { name: "Couldn't reach Domain 3" })).toBeInTheDocument();
    expect(screen.getByText("Couldn't reach Domain 3").closest('li')).toHaveClass('is-failed');
    // A domain names no host: the help names the one in the address.
    expect(screen.getByText(/running on base.example and that this device can reach it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to connections' }));
    expect([onRetry, onContinue, onCancel].every(fn => fn.mock.calls.length === 1)).toBe(true);
  });

  it('marks the link made once the robot answers', () => {
    const { container } = render(<WorkspaceOpening stage="connected" target="robot.local" />);
    expect(screen.getByRole('status', { name: 'Connected to robot.local' })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('is-connected', 'is-over-workspace');
  });
});
