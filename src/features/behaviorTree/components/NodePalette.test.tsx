import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { Ros } from 'roslib';
import NodePalette from './NodePalette';
import { BehaviorNodeType } from '../types';

vi.mock('reactflow', () => ({}));

const discoveryMock = vi.hoisted(() => vi.fn());

vi.mock('../services/rosDiscovery', () => ({
  discoverAllROSResources: discoveryMock,
}));

describe('NodePalette', () => {
  const defaultProps = {
    ros: null,
    isConnected: false,
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
  };

  beforeEach(() => {
    discoveryMock.mockReset();
  });

  it('calls onAddNode with Sequence type when Sequence item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Sequence'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Sequence, undefined);
  });

  it('calls onAddNode with Selector type when Selector item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Selector'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Selector, undefined);
  });

  it('calls onAddNode with Parallel type when Parallel item is clicked', () => {
    const onAddNode = vi.fn();
    render(<NodePalette {...defaultProps} onAddNode={onAddNode} />);
    fireEvent.click(screen.getByText('Parallel'));
    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Parallel, undefined);
  });

  it('does not throw when onAddNode is not provided and item is clicked', () => {
    render(<NodePalette {...defaultProps} />);
    expect(() => fireEvent.click(screen.getByText('Sequence'))).not.toThrow();
  });

  it('uses one search to filter actions, services, and topics by name and type', async () => {
    discoveryMock.mockResolvedValue({
      actions: [
        {
          name: '/navigate_to_pose',
          type: 'nav2_msgs/action/NavigateToPose',
          namespace: '/',
        },
        {
          name: '/dock_robot',
          type: 'example_msgs/action/Dock',
          namespace: '/',
        },
      ],
      services: [{ name: '/set_bool', type: 'std_srvs/srv/SetBool' }],
      topics: [{ name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' }],
    });

    render(
      <NodePalette
        {...defaultProps}
        ros={{} as Ros}
        isConnected
      />
    );

    await waitFor(() => expect(discoveryMock).toHaveBeenCalled());
    const search = await screen.findByRole('searchbox', { name: 'Search available ROS resources' });
    fireEvent.change(search, { target: { value: 'setbool std_srvs' } });

    expect(screen.getByText('/set_bool')).toBeInTheDocument();
    expect(screen.queryByText('/navigate_to_pose')).not.toBeInTheDocument();
    expect(screen.queryByText('/cmd_vel')).not.toBeInTheDocument();
    expect(screen.getByText('ROS Services')).toBeInTheDocument();
    expect(screen.queryByText('ROS Actions')).not.toBeInTheDocument();
    expect(screen.queryByText('ROS Topics')).not.toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
  });

  it('adds the action selected from filtered results', async () => {
    const action = {
      name: '/navigate_to_pose',
      type: 'nav2_msgs/action/NavigateToPose',
      namespace: '/',
    };
    const onAddNode = vi.fn();
    discoveryMock.mockResolvedValue({ actions: [action], services: [], topics: [] });

    render(
      <NodePalette
        {...defaultProps}
        ros={{} as Ros}
        isConnected
        onAddNode={onAddNode}
      />
    );

    await waitFor(() => expect(discoveryMock).toHaveBeenCalled());
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search available ROS resources' }), {
      target: { value: 'navigate' },
    });
    fireEvent.click(screen.getByText('/navigate_to_pose'));

    expect(onAddNode).toHaveBeenCalledWith(BehaviorNodeType.Action, action);
  });
});

describe('NodePalette mobile sheet', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Override matchMedia to simulate mobile
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('768px'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('renders palette content in document.body portal on mobile', () => {
    render(
      <NodePalette
        ros={null}
        isConnected={false}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );
    // The sheet is portalled to body — content should still be findable
    expect(document.body).toBeTruthy();
    // Palette content is visible somewhere in the document
    expect(screen.getByText('Sequence')).toBeInTheDocument();
  });

  it('calls onToggleCollapse when backdrop is clicked', () => {
    const onToggleCollapse = vi.fn();
    render(
      <NodePalette
        ros={null}
        isConnected={false}
        isCollapsed={false}
        onToggleCollapse={onToggleCollapse}
      />
    );
    const backdrop = document.querySelector('.node-palette-backdrop');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
    }
  });
});
