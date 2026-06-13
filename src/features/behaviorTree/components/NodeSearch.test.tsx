import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BehaviorNodeType, BehaviorTreeNode } from '../types';
import NodeSearch from './NodeSearch';

const nodes: BehaviorTreeNode[] = [
  {
    id: 'node-0',
    type: BehaviorNodeType.Action,
    position: { x: 0, y: 0 },
    data: {
      label: 'Navigate Home',
      actionName: '/navigate_to_pose',
      actionType: 'nav2_msgs/action/NavigateToPose',
    },
  },
  {
    id: 'node-1',
    type: BehaviorNodeType.Service,
    position: { x: 200, y: 0 },
    data: {
      label: 'Navigate Backup',
      serviceName: '/navigate_backup',
      serviceType: 'example_msgs/srv/NavigateBackup',
    },
  },
];

describe('NodeSearch', () => {
  it('finds a node by ROS name and selects it', () => {
    const onSelectNode = vi.fn();
    render(<NodeSearch nodes={nodes} onSelectNode={onSelectNode} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search tree nodes' }), {
      target: { value: 'navigate_to_pose' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Navigate Home/ }));

    expect(onSelectNode).toHaveBeenCalledWith(nodes[0]);
  });

  it('supports arrow-key navigation and Enter', () => {
    const onSelectNode = vi.fn();
    render(<NodeSearch nodes={nodes} onSelectNode={onSelectNode} />);
    const input = screen.getByRole('combobox', { name: 'Search tree nodes' });

    fireEvent.change(input, { target: { value: 'navigate' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelectNode).toHaveBeenCalledWith(nodes[1]);
  });

  it('shows an empty state when no nodes match', () => {
    render(<NodeSearch nodes={nodes} onSelectNode={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search tree nodes' }), {
      target: { value: 'missing node' },
    });

    expect(screen.getByRole('status')).toHaveTextContent('No matching nodes');
  });
});
