import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { Ros } from 'roslib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParameterSnapshot } from './parameterClient';
import type { Resource } from './types';

const fake = vi.hoisted(() => ({
  load: vi.fn(),
  apply: vi.fn(),
  block: '',
  events: undefined as undefined | ((value: unknown) => void),
  unsubscribe: vi.fn(),
}));
vi.mock('./parameterClient', () => ({
  loadNodeParameters: fake.load,
  applyNodeParameters: fake.apply,
  parameterWriteBlock: () => fake.block,
  PARAMETER_LIMIT: 512,
}));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      subscribe(callback: (value: unknown) => void) {
        fake.events = callback;
      }
      unsubscribe() {
        fake.unsubscribe();
      }
    },
  },
}));
import ParametersView from './ParametersView';

const ros = { isConnected: true } as Ros;
const nodes: Resource[] = ['/controller', '/other'].map(name => ({
  id: `node:${name}`,
  name,
  kind: 'node',
  types: [],
  providers: [],
  consumers: [],
}));
function snapshot(): ParameterSnapshot {
  return {
    parameters: [
      {
        name: 'speed',
        type: 3,
        value: 1,
        descriptor: {
          name: 'speed',
          type: 3,
          read_only: false,
          dynamic_typing: false,
          description: 'Maximum speed',
          additional_constraints: 'Hardware validates this too',
          integer_range: [],
          floating_point_range: [{ from_value: 0, to_value: 5, step: 0 }],
        },
      },
    ],
    total: 1,
    atomic: true,
    writable: true,
  };
}
function Harness({
  active = true,
  connection = ros,
  replay = false,
}: {
  active?: boolean;
  connection?: Ros | null;
  replay?: boolean;
}) {
  const [node, setNode] = useState('/controller');
  return (
    <ParametersView ros={connection} active={active} replay={replay} nodes={nodes} node={node} onNodeChange={setNode} />
  );
}
async function stage(value = '2') {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit speed' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Proposed value' }), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Stage change' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  fake.block = '';
  fake.events = undefined;
  fake.load.mockResolvedValue(snapshot());
  fake.apply.mockResolvedValue([{ name: 'speed', successful: true, reason: '' }]);
});

describe('Parameters view', () => {
  it('treats prototype-like parameter names as ordinary editable values', async () => {
    const data = snapshot();
    data.parameters = ['constructor', '__proto__'].map(name => ({
      ...data.parameters[0],
      name,
      descriptor: { ...data.parameters[0].descriptor, name },
    }));
    fake.load.mockResolvedValue(data);
    render(<Harness />);
    for (const name of ['constructor', '__proto__']) {
      fireEvent.click(await screen.findByRole('button', { name: `Edit ${name}` }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Proposed value' }), { target: { value: '2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Stage change' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('region', { name: 'Review parameter changes' })).toHaveTextContent('__proto__');
    expect(screen.getByText('2 parameters · 2 staged')).toBeVisible();
  });
  it('stages, reviews and applies only after an explicit apply click', async () => {
    render(<Harness />);
    await stage();
    expect(fake.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('region', { name: 'Review parameter changes' })).toHaveTextContent('1 → 2');
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(fake.apply).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('1 of 1 changes applied');
    expect(screen.getByText('1 parameters · 0 staged')).toBeVisible();
  });

  it('allows observers to browse and stage, but explains why apply is disabled', async () => {
    fake.block = 'Request control from the top bar before applying changes.';
    render(<Harness />);
    await stage();
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    expect(screen.getByText(fake.block)).toBeVisible();
    expect(fake.apply).not.toHaveBeenCalled();
  });

  it('validates ranges and shows read-only descriptors', async () => {
    const data = snapshot();
    data.parameters.push({
      ...data.parameters[0],
      name: 'locked',
      descriptor: { ...data.parameters[0].descriptor, name: 'locked', read_only: true },
    });
    fake.load.mockResolvedValue(data);
    render(<Harness />);
    await stage('10');
    expect(screen.getByRole('alert')).toHaveTextContent('between 0 and 5');
    fireEvent.click(screen.getByRole('button', { name: 'Edit locked' }));
    expect(screen.getByRole('button', { name: 'Stage change' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Proposed value' })).toBeDisabled();
  });

  it('keeps drafts per node while hidden and clears them when the connection changes', async () => {
    const view = render(<Harness />);
    await stage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Parameter node' }), { target: { value: '/other' } });
    await waitFor(() => expect(screen.getByText('1 parameters · 0 staged')).toBeVisible());
    fireEvent.change(screen.getByRole('combobox', { name: 'Parameter node' }), { target: { value: '/controller' } });
    await waitFor(() => expect(screen.getByText('1 parameters · 1 staged')).toBeVisible());
    view.rerender(<Harness active={false} />);
    expect(screen.getByText('1 parameters · 1 staged')).toBeVisible();
    view.rerender(<Harness connection={{ isConnected: true } as Ros} />);
    await waitFor(() => expect(screen.getByText('1 parameters · 0 staged')).toBeVisible());
  });

  it('refreshes after parameter events, marks conflicting drafts and cleans up when inactive', async () => {
    const view = render(<Harness />);
    await stage();
    const changed = snapshot();
    changed.parameters[0].value = 3;
    fake.load.mockResolvedValue(changed);
    act(() => fake.events?.({ node: '/controller' }));
    await waitFor(() =>
      expect(screen.getByText('The live value changed. Discard this edit and stage it again.')).toBeVisible()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    view.rerender(<Harness active={false} />);
    expect(fake.unsubscribe).toHaveBeenCalled();
  });

  it('keeps the node rejection reason visible after refreshing values', async () => {
    fake.apply.mockResolvedValue([{ name: 'speed', successful: false, reason: 'Motor controller is running' }]);
    render(<Harness />);
    await stage();
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
    await waitFor(() => expect(fake.load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Motor controller is running');
  });

  it('labels replay as unavailable and never queries a live robot behind that label', () => {
    render(<Harness replay />);
    expect(screen.getByText(/Parameters were not recorded/)).toBeVisible();
    expect(fake.load).not.toHaveBeenCalled();
  });
});
