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
          data-selected={node.selected}
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
          data-selected={edge.selected}
          data-marker-color={edge.markerEnd?.color}
          data-marker-width={edge.markerEnd?.width}
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
  transform: {
    translation: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  },
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

    fireEvent.click(screen.getByTestId('tf-tree-menu-button'));
    const summary = screen.getByLabelText('TF graph summary');
    expect(summary).toHaveTextContent('4 frames');
    expect(summary).toHaveTextContent('2 transforms');
    expect(summary).toHaveTextContent('2 trees');
    expect(screen.getByTestId('tf-edge-base')).toHaveTextContent('DYNAMIC');
    expect(screen.getByTestId('tf-edge-camera')).toHaveTextContent('STATIC');
    expect(screen.getByTestId('tf-node-map')).toBeInTheDocument();
    expect(screen.getByTestId('tf-node-world')).toBeInTheDocument();
  });

  it('pauses updates, arranges the graph, and hides static transforms', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    fireEvent.click(screen.getByLabelText('Pause live TF updates'));
    expect(panelMock.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Arrange TF tree'));
    expect(panelMock.fitView).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId('tf-tree-menu-button'));
    fireEvent.click(screen.getByLabelText('Static TF'));
    expect(screen.queryByTestId('tf-edge-camera')).not.toBeInTheDocument();
    expect(screen.getByLabelText('TF graph summary')).toHaveTextContent('2 frames');
  });

  it('searches and centers a frame, filters graph context, and shows edge details', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    const search = screen.getByLabelText('Search TF frame');
    fireEvent.change(search, { target: { value: 'camera' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(panelMock.setCenter).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('tf-edge-camera'));
    expect(screen.getByText('/tf_static')).toBeInTheDocument();
    expect(screen.getAllByText('Static', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('1.0000, 2.0000, 3.0000')).toBeInTheDocument();
    expect(screen.getByText('0.0000, 0.0000, 0.0000, 1.0000')).toBeInTheDocument();
    expect(screen.getByTestId('tf-edge-camera')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('tf-edge-camera')).toHaveAttribute('data-marker-color', '#ffb300');
    expect(screen.getByTestId('tf-edge-camera')).toHaveAttribute('data-marker-width', '12');
    fireEvent.click(screen.getByLabelText('Close TF details'));
    expect(screen.queryByLabelText('TF selection details')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tf-tree-menu-button'));
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

    fireEvent.click(screen.getByTestId('tf-tree-menu-button'));
    expect(screen.getByRole('alert')).toHaveTextContent('multiple observed parents');
    expect(screen.getByRole('alert')).toHaveTextContent('Cycle detected');
    expect(screen.getByTestId('tf-edge-b').getAttribute('data-class')).toContain('stale');
  });

  it('lists visible TF components and fits only the selected tree', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    fireEvent.click(screen.getByTestId('tf-tree-menu-button'));
    fireEvent.click(screen.getByTestId('tf-tree-component-0'));

    const options = panelMock.fitView.mock.calls[0][0];
    expect(options.nodes.map((node: { id: string }) => node.id)).toEqual(['base', 'map']);
    expect(screen.queryByTestId('tf-tree-menu-panel')).not.toBeInTheDocument();
  });

  it('calculates between autocompleted frames and supports picking frames from the tree', () => {
    render(<TfTreePanel ros={{} as never} isActive />);

    fireEvent.click(screen.getByLabelText('Open TF calculator'));
    const source = screen.getByLabelText('TF calculator source frame');
    const target = screen.getByLabelText('TF calculator target frame');
    fireEvent.change(source, { target: { value: 'map' } });
    fireEvent.change(target, { target: { value: 'base' } });

    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('base');
    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('relative to map');
    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('1.0000, 2.0000, 3.0000');
    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('Euler RPY (deg)');
    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('Rotation matrix');

    fireEvent.click(screen.getByLabelText('Pick source frame from tree'));
    expect(screen.queryByTestId('tf-calculator')).not.toBeInTheDocument();
    expect(screen.getByTestId('tf-tree-pick-frame')).toHaveTextContent('Select the source frame');
    fireEvent.click(screen.getByTestId('tf-node-world'));

    expect(screen.getByTestId('tf-calculator')).toBeInTheDocument();
    expect(screen.getByLabelText('TF calculator source frame')).toHaveValue('world');
    expect(screen.getByTestId('tf-calculator')).toHaveTextContent('No connected TF path');

    fireEvent.click(screen.getByLabelText('Close TF calculator'));
    expect(screen.queryByTestId('tf-calculator')).not.toBeInTheDocument();
  });
});
