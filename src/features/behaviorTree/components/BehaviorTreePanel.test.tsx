import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BehaviorTreePanel from './BehaviorTreePanel';

vi.mock('reactflow', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="mock-react-flow">{children}</div>
  ),
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
  it('does not open the node palette until the user toggles it', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.queryByTestId('bt-node-palette')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));

    expect(screen.getByTestId('bt-node-palette')).toBeInTheDocument();
  });
});
