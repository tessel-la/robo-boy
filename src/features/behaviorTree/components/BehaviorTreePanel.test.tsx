import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BehaviorTreePanel from './BehaviorTreePanel';

const reactFlowMock = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('reactflow', () => ({
  default: (props: { children?: React.ReactNode }) => {
    reactFlowMock.render(props);
    return <div data-testid="mock-react-flow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  addEdge: vi.fn((_edge, edges) => edges),
  useNodesState: () => [[], vi.fn(), vi.fn()],
  useEdgesState: () => [[], vi.fn(), vi.fn()],
  useReactFlow: () => ({
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    deleteElements: vi.fn(),
  }),
}));

describe('BehaviorTreePanel', () => {
  beforeEach(() => {
    reactFlowMock.render.mockClear();
  });

  it('does not open the node palette until the user toggles it', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.queryByTestId('bt-node-palette')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));

    expect(screen.getByTestId('bt-node-palette')).toBeInTheDocument();
  });

  it('uses a touch-friendly connection radius', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(reactFlowMock.render).toHaveBeenCalledWith(
      expect.objectContaining({ connectionRadius: 48 })
    );
  });
});
