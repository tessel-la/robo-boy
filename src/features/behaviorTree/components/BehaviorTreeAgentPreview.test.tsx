import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, BehaviorTree } from '../types';
import BehaviorTreeAgentPreview, { summarizeTreeChanges } from './BehaviorTreeAgentPreview';

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
});
