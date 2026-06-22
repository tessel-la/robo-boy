import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { consumeTfMessage, createEmptyTfTreeState, TfTreeState } from '../tfTreeModel';
import TfTreePanel from './TfTreePanel';

const panelMock = vi.hoisted(() => ({
  state: null as TfTreeState | null,
  isPaused: false,
  pause: vi.fn(),
  resume: vi.fn(),
  fitView: vi.fn(),
  setCenter: vi.fn(),
}));

vi.mock('../useTfTree', () => ({
  useTfTree: () => ({
    state: panelMock.state,
    isPaused: panelMock.isPaused,
    pause: panelMock.pause,
    resume: panelMock.resume,
  }),
}));

vi.mock('reactflow', () => ({
  default: (props: {
    nodes: Array<Record<string, any>>;
    edges: Array<Record<string, any>>;
    children?: React.ReactNode;
    onNodeClick?: (event: React.MouseEvent, node: Record<string, any>) => void;
    onEdgeClick?: (event: React.MouseEvent, edge: Record<string, any>) => void;
  }) => (
    <div data-testid="mock-tf-flow">
      {props.nodes.map(node => (
        <button
          type="button"
          key={node.id}
          data-testid={`tf-node-${node.id}`}
          data-class={node.className}
          onClick={event => props.onNodeClick?.(event, node)}
        >
          {node.data.label}
        </button>
      ))}
      {props.edges.map(edge => (
        <button
          type="button"
          key={edge.id}
          data-testid={`tf-edge-${edge.target}`}
          data-class={edge.className}
          onClick={event => props.onEdgeClick?.(event, edge)}
        >
          {edge.label}
        </button>
      ))}
      {props.children}
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Top: 'top', Bottom: 'bottom' },
  useReactFlow: () => ({
    fitView: panelMock.fitView,
    setCenter: panelMock.setCenter,
  }),
}));

const transform = (parent: string, child: string, sec = 10) => ({
  header: { frame_id: parent, stamp: { sec, nanosec: 0 } },
  child_frame_id: child,
});

const buildState = () => {
  let state = consumeTfMessage(
    createEmptyTfTreeState(),
    { transforms: [transform('map', 'base')] },
    'dynamic',
    Date.now()
  );
  state = consumeTfMessage(state, { transforms: [transform('world', 'camera')] }, 'static', Date.now());
  return state;
};

describe('TfTreePanel', () => {
  beforeEach(() => {
    panelMock.state = buildState();
    panelMock.isPaused = false;
    panelMock.pause.mockReset();
    panelMock.resume.mockReset();
    panelMock.fitView.mockReset();
    panelMock.setCenter.mockReset();
  });

  it('renders disconnected dynamic and static TF trees with summary metadata', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    expect(screen.getByText('4 frames')).toBeInTheDocument();
    expect(screen.getByText('2 transforms')).toBeInTheDocument();
    expect(screen.getByText('2 trees')).toBeInTheDocument();
    expect(screen.getByTestId('tf-edge-camera')).toHaveTextContent('STATIC');
    expect(screen.getByTestId('tf-node-map')).toBeInTheDocument();
    expect(screen.getByTestId('tf-node-world')).toBeInTheDocument();
  });

  it('pauses updates, fits the graph, and hides static transforms', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    fireEvent.click(screen.getByLabelText('Pause live TF updates'));
    expect(panelMock.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Fit TF graph to view'));
    expect(panelMock.fitView).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText('Static TF'));
    expect(screen.queryByTestId('tf-edge-camera')).not.toBeInTheDocument();
    expect(screen.getByText('2 frames')).toBeInTheDocument();
  });

  it('searches and centers a frame, filters graph context, and shows edge details', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    fireEvent.change(screen.getByLabelText('Search TF frame'), { target: { value: 'camera' } });
    fireEvent.submit(screen.getByLabelText('Search TF frame').closest('form')!);
    expect(panelMock.setCenter).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tf-edge-camera'));
    expect(screen.getByText('/tf_static')).toBeInTheDocument();
    expect(screen.getAllByText('Static', { selector: 'dd' })).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Filter TF frames'), { target: { value: 'base' } });
    expect(screen.getByTestId('tf-node-map')).toBeInTheDocument();
    expect(screen.getByTestId('tf-node-base')).toBeInTheDocument();
    expect(screen.queryByTestId('tf-node-camera')).not.toBeInTheDocument();
  });

  it('marks stale dynamic transforms and surfaces graph warnings', () => {
    let state = consumeTfMessage(
      createEmptyTfTreeState(),
      { transforms: [transform('a', 'b', 10)] },
      'dynamic',
      Date.now() - 10_000
    );
    state = consumeTfMessage(
      state,
      { transforms: [transform('b', 'a', 11), transform('other', 'b', 9)] },
      'dynamic',
      Date.now() - 10_000
    );
    panelMock.state = state;

    render(<TfTreePanel ros={{} as never} isActive />);

    expect(screen.getByRole('alert')).toHaveTextContent('multiple observed parents');
    expect(screen.getByRole('alert')).toHaveTextContent('Cycle detected');
    expect(screen.getByTestId('tf-edge-b').getAttribute('data-class')).toContain('stale');
  });
});
