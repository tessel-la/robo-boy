import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NativeTreeStatus } from './NativeTreeSettings';
import type { NativeTreeController } from './useNativeTreeController';
import type { RuntimeState } from './types';

const descriptor = {
  label: 'engine',
  capabilities: { xml: true, selfContainedOnly: true, cancel: true, reset: true, feedback: true, nativeNodes: true },
};
const state = {
  connected: true,
  runtimes: [
    { ...descriptor, id: 'btcpp', available: false, enabled: false },
    { ...descriptor, id: 'py_trees', available: true, enabled: true },
  ],
  session: null,
  logs: [],
  observations: [],
  error: null,
} as RuntimeState;
const controller = {
  document: { runtime: 'py_trees' },
  compatible: true,
  preview: { error: null },
} as NativeTreeController;
describe('engine and observation status', () => {
  it('uses the selected document engine for managed availability', () => {
    render(<NativeTreeStatus controller={controller} state={state} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
  });
  it('distinguishes external telemetry loss and monitor disabling from executor availability', () => {
    const watched = {
      ...controller,
      observed: { runtime: 'py_trees', state: 'running', source: '/robot/snapshots', connected: true },
    } as NativeTreeController;
    const unavailable = { ...state, runtimes: [{ ...state.runtimes[1], available: false }] };
    const { rerender } = render(<NativeTreeStatus controller={watched} state={unavailable} />);
    expect(screen.getByRole('status')).toHaveTextContent('Watching · Running');
    rerender(<NativeTreeStatus controller={watched} state={{ ...unavailable, connected: false }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Telemetry lost');
    rerender(
      <NativeTreeStatus
        controller={watched}
        state={{ ...unavailable, runtimes: [{ ...unavailable.runtimes[0], enabled: false }] }}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Monitoring off');
  });
});
