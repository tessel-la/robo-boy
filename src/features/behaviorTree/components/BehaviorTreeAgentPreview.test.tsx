import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, BehaviorTree } from '../types';
import BehaviorTreeAgentPreview, { buildTreeDiff, summarizeTreeChanges } from './BehaviorTreeAgentPreview';

const baseline: BehaviorTree = {
  id: 'tree', name: 'Mission', createdAt: 1, updatedAt: 1,
  nodes: [{ id: 'move', type: BehaviorNodeType.Action, position: { x: 0, y: 0 }, data: { label: 'Move', actionName: '/move', actionType: 'robot/action/Move', parameters: { x: 0 } } }],
  edges: [],
};
const proposal: BehaviorTree = {
  ...baseline,
  name: 'Updated mission',
  description: 'Assumes relative movement.',
  nodes: [
    { ...baseline.nodes[0], data: { ...baseline.nodes[0].data, parameters: { x: 0.5, y: 0 } } },
    { id: 'capture', type: BehaviorNodeType.Service, position: { x: 0, y: 120 }, data: { label: 'Capture', serviceName: '/capture', serviceType: 'camera/srv/Capture', request: { quality: 90 } } },
  ],
  edges: [{ id: 'edge', source: 'move', target: 'capture' }],
};

describe('BehaviorTreeAgentPreview', () => {
  it('summarizes and previews staged changes with exact inputs', () => {
    expect(summarizeTreeChanges(baseline, proposal)).toEqual({ added: 1, removed: 0, changed: 1, unchanged: 0 });
    render(<BehaviorTreeAgentPreview tree={proposal} baseline={baseline} onReject={vi.fn()} onAccept={vi.fn()} />);

    expect(screen.getByRole('img', { name: 'Preview of Updated mission' })).toBeInTheDocument();
    expect(screen.getByText('Assumes relative movement.')).toBeInTheDocument();
    expect(screen.getByText('/move')).toBeInTheDocument();
    expect(screen.getByText('/capture')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changes' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Move, changed' }));
    expect(screen.getByText('changed · action')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Current' }));
    expect(screen.getByRole('button', { name: 'Current' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('requires an explicit accept mode or rejection', () => {
    const onReject = vi.fn();
    const onAccept = vi.fn();
    render(<BehaviorTreeAgentPreview tree={proposal} baseline={baseline} onReject={onReject} onAccept={onAccept} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept as subtree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept replacement' }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenNthCalledWith(1, 'subtree');
    expect(onAccept).toHaveBeenNthCalledWith(2, 'replace');
  });

  it('compares renamed resources, removed nodes, and subscriber payloads', () => {
    const current: BehaviorTree = {
      ...baseline,
      nodes: [
        ...baseline.nodes,
        { id: 'old-wait', type: BehaviorNodeType.Timeout, position: { x: 0, y: 120 }, data: { label: 'Wait', timeout: 1000 } },
      ],
      edges: [{ id: 'old-edge', source: 'move', target: 'old-wait' }],
    };
    const proposed: BehaviorTree = {
      ...baseline,
      nodes: [
        { id: 'move-renamed', type: BehaviorNodeType.Action, position: { x: 0, y: 0 }, data: { label: 'Move faster', actionName: '/move', actionType: 'robot/action/Move', parameters: { x: 1 } } },
        { id: 'watch', type: BehaviorNodeType.Subscriber, position: { x: 0, y: 120 }, data: { label: 'Watch obstacle', topicName: '/obstacle', messageType: 'std_msgs/msg/Bool', timeout: 2000, outputBindings: [{ sourcePath: 'data', variable: 'obstacle' }] } },
      ],
      edges: [{ id: 'new-edge', source: 'move-renamed', target: 'watch' }],
    };

    const diff = buildTreeDiff(current, proposed);
    expect(diff.currentToProposed.get('move')).toBe('move-renamed');
    expect(summarizeTreeChanges(current, proposed)).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0 });

    render(<BehaviorTreeAgentPreview tree={proposed} baseline={current} onReject={vi.fn()} onAccept={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Wait, removed' }));
    expect(screen.getByText('No runtime parameters for this control node.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Watch obstacle, added' }));
    expect(screen.getAllByText('/obstacle').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/outputBindings/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Proposed' }));
    expect(screen.getByRole('button', { name: 'Proposed' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('115%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%');
  });

  it('renders compact canvas notice without duplicate review actions', () => {
    render(<BehaviorTreeAgentPreview tree={proposal} baseline={baseline} onReject={vi.fn()} onAccept={vi.fn()} compact showActions={false} />);

    expect(screen.getByText('Preview active on canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept replacement' })).not.toBeInTheDocument();
  });
});
