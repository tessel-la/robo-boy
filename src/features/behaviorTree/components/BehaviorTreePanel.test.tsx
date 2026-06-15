import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BehaviorTreePanel from './BehaviorTreePanel';

const reactFlowMock = vi.hoisted(() => ({
  render: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  setNodes: vi.fn(),
  setEdges: vi.fn(),
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
  useNodesState: () => [reactFlowMock.nodes, reactFlowMock.setNodes, vi.fn()],
  useEdgesState: () => [reactFlowMock.edges, reactFlowMock.setEdges, vi.fn()],
  useReactFlow: () => ({
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    deleteElements: vi.fn(),
    fitView: vi.fn(),
  }),
}));

describe('BehaviorTreePanel', () => {
  beforeEach(() => {
    reactFlowMock.render.mockClear();
    reactFlowMock.nodes = [];
    reactFlowMock.edges = [];
    reactFlowMock.setNodes.mockReset();
    reactFlowMock.setEdges.mockReset();
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

  it('offers a responsive tree arrangement action', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.getByRole('button', { name: 'Arrange tree' })).toBeInTheDocument();
  });

  it('selects a clicked edge and the child node it points to', () => {
    reactFlowMock.nodes = [
      { id: 'parent', position: { x: 0, y: 0 }, data: {}, selected: true },
      { id: 'child', position: { x: 0, y: 100 }, data: {}, selected: false },
    ];
    reactFlowMock.edges = [
      { id: 'edge-1', source: 'parent', target: 'child', selected: false },
      { id: 'edge-2', source: 'parent', target: 'other', selected: true },
    ];

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      onEdgeClick: (event: React.MouseEvent, edge: Record<string, unknown>) => void;
    };

    act(() => {
      props.onEdgeClick({} as React.MouseEvent, reactFlowMock.edges[0]);
    });

    const updateNodes = reactFlowMock.setNodes.mock.calls[0][0];
    const updateEdges = reactFlowMock.setEdges.mock.calls[0][0];
    expect(updateNodes(reactFlowMock.nodes)).toEqual([
      expect.objectContaining({ id: 'parent', selected: false }),
      expect.objectContaining({ id: 'child', selected: true }),
    ]);
    expect(updateEdges(reactFlowMock.edges)).toEqual([
      expect.objectContaining({ id: 'edge-1', selected: true }),
      expect.objectContaining({ id: 'edge-2', selected: false }),
    ]);
  });
});
