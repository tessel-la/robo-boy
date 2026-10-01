import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NativeTreeWorkspace from './NativeTreeWorkspace';
import { nativeTreeFromXml, treeFormats } from './xml';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';

const mocked = vi.hoisted(() => ({
  client: {
    discover: vi.fn(),
    validate: vi.fn(),
    load: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    setEnabled: vi.fn(),
  },
  state: {} as any,
}));
vi.mock('reactflow', () => ({
  default: () => <div data-testid="native-flow" />,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));
function setup(format = treeFormats[0]) {
  const tree = nativeTreeFromXml(format.template, format.id);
  const onChange = vi.fn();
  const onExecutionChange = vi.fn();
  const props = {
    tree,
    runtime: mocked as unknown as ReturnType<typeof useRemoteTreeRuntime>,
    isConnected: true,
    onChange,
    onNewGraph: vi.fn(),
    onExecutionChange,
  };
  return { ...render(<NativeTreeWorkspace {...props} />), props, onChange };
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.values(mocked.client).forEach(fn => fn.mockResolvedValue({}));
  mocked.state = {
    connected: true,
    runtimes: treeFormats.map(f => ({ id: f.id, label: f.label, available: true, version: 'test' })),
    session: null,
    logs: [],
    error: null,
  };
});
describe('common native XML workspace', () => {
  it.each(treeFormats)('uses the same controls and original XML for $id', async format => {
    const { props, rerender } = setup(format);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Load on host' }));
    await waitFor(() => expect(mocked.client.load).toHaveBeenCalledWith(props.tree.nativeDocument));
    mocked.state.session = {
      id: 's',
      runtime: format.id,
      xml: format.template,
      mainTreeId: 'Main',
      nodes: [],
      state: 'loaded',
      result: null,
      error: null,
    };
    rerender(<NativeTreeWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(mocked.client.start).toHaveBeenCalled());
    mocked.state.session.state = 'running';
    rerender(<NativeTreeWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'XML source' }));
    expect(screen.getByLabelText('Tree XML')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocked.client.cancel).toHaveBeenCalled());
  });
  it('resets a completed host tree before rerunning it', async () => {
    const { props, rerender } = setup();
    mocked.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml: props.tree.nativeDocument!.xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'completed',
      result: 'success',
      error: null,
    };
    rerender(<NativeTreeWorkspace {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(mocked.client.start).toHaveBeenCalled());
    expect(mocked.client.reset.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.client.start.mock.invocationCallOrder[0]
    );
  });
  it('exposes unavailable and disconnected hosts with disabled execution', () => {
    mocked.state.runtimes[0].available = false;
    mocked.state.runtimes[0].reason = 'Executable missing';
    const { props, rerender } = setup();
    expect(screen.getByText(/Executable missing/)).toBeVisible();
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    expect(screen.getByRole('button', { name: 'Load on host' })).toBeDisabled();
    mocked.state.connected = false;
    rerender(<NativeTreeWorkspace {...props} isConnected={false} />);
    expect(screen.getByText(/ROS disconnected/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });
  it('saves backend format and exact source, including native metadata', () => {
    const { props } = setup();
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = JSON.parse(localStorage.getItem('robo-boy-behavior-trees')!);
    expect(saved[0].tree.nativeDocument).toEqual(props.tree.nativeDocument);
  });
  it('does not control a host tree different from the visible source', () => {
    mocked.state.session = {
      id: 'other',
      runtime: 'py_trees',
      xml: treeFormats[1].template,
      mainTreeId: 'Main',
      nodes: [],
      state: 'running',
    };
    setup();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show host tree' })).toBeEnabled();
  });
  it('shows feedback, errors and failure results', () => {
    const { props, rerender } = setup();
    mocked.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml: props.tree.nativeDocument!.xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'completed',
      result: 'failure',
      error: null,
    };
    mocked.state.logs = [
      { type: 'feedback', feedback: { progress: 0.5 } },
      { type: 'result', result: { message: 'failed' } },
    ];
    rerender(<NativeTreeWorkspace {...props} />);
    expect(screen.getByTestId('bt-runtime-state')).toHaveTextContent('completed: failure');
    expect(screen.getByRole('log')).toHaveTextContent('progress');
  });
  it('loads the current XML automatically when Run is clicked', async () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(mocked.client.start).toHaveBeenCalled());
    expect(mocked.client.load).toHaveBeenCalledWith(props.tree.nativeDocument);
  });
  it('allows disabling engines independently and blocks execution when disabled', async () => {
    const { props, rerender } = setup();
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByRole('switch', { name: 'Enable BehaviorTree.CPP' }));
    await waitFor(() => expect(mocked.client.setEnabled).toHaveBeenCalledWith('btcpp', false));
    mocked.state.runtimes[0].enabled = false;
    rerender(<NativeTreeWorkspace {...props} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Enable py_trees' })).toBeChecked();
  });
});
