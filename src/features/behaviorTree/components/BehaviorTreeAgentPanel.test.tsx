import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorNodeType, BehaviorTree } from '../types';
import BehaviorTreeAgentPanel from './BehaviorTreeAgentPanel';

const tree: BehaviorTree = {
  id: 'tree',
  name: 'Mission',
  nodes: [
    { id: 'root', type: BehaviorNodeType.Sequence, position: { x: 0, y: 0 }, data: { label: 'Mission', type: 'sequence' } },
    { id: 'move', type: BehaviorNodeType.Action, position: { x: 0, y: 100 }, data: { label: 'Move', actionName: '/move', actionType: 'robot/action/Move' } },
  ],
  edges: [{ id: 'edge', source: 'root', target: 'move' }],
  createdAt: 1,
  updatedAt: 1,
};

const selection: BehaviorTree = { ...tree, id: 'selection', name: 'Selection', nodes: [tree.nodes[1]], edges: [] };

describe('BehaviorTreeAgentPanel', () => {
  beforeEach(() => localStorage.clear());

  it('shows explicit open-tree and selected-part context choices', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={selection} onClose={vi.fn()} onApply={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Selected part/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Using only the 1 selected node and its internal connections.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open tree/ }));
    expect(screen.getByRole('button', { name: /Open tree/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps generation locked without a discovered action or service', () => {
    render(<BehaviorTreeAgentPanel open ros={null} isConnected={false} currentTree={tree} selectedTreeContext={null} onClose={vi.fn()} onApply={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move forward' } });
    expect(screen.getByRole('button', { name: 'Generate tree' })).toBeDisabled();
    expect(screen.getByText('Scan at least one action or service to continue.')).toBeInTheDocument();
  });
});
