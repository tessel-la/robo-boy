import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BehaviorTreePanel from './BehaviorTreePanel';

const reactFlowMock = vi.hoisted(() => ({
  render: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
  edges: [] as Array<Record<string, unknown>>,
  nodeRects: {} as Record<string, DOMRect>,
  edgeRects: {} as Record<string, DOMRect>,
  selectionRect: null as DOMRect | null,
  setCenter: vi.fn(),
  fitView: vi.fn(),
}));

const createRect = (x: number, y: number, width: number, height: number): DOMRect => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({}),
} as DOMRect);

vi.mock('reactflow', () => ({
  default: (props: {
    children?: React.ReactNode;
    nodes?: Array<Record<string, any>>;
    edges?: Array<Record<string, any>>;
    onNodeClick?: (event: React.MouseEvent, node: Record<string, any>) => void;
    onNodesChange?: (changes: Array<Record<string, any>>) => void;
    onEdgesChange?: (changes: Array<Record<string, any>>) => void;
    onSelectionStart?: () => void;
    onSelectionEnd?: () => void;
    onSelectionChange?: (selection: {
      nodes: Array<Record<string, any>>;
      edges: Array<Record<string, any>>;
    }) => void;
  }) => {
    reactFlowMock.render(props);
    return (
      <div data-testid="mock-react-flow" className="react-flow react-flow__pane">
        {props.nodes?.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`rf-node-${node.id}`}
            data-id={node.id}
            data-highlighted={node.data?.isHighlighted ? 'true' : 'false'}
            data-selected={node.selected ? 'true' : 'false'}
            className={`react-flow__node${node.selected ? ' selected' : ''}`}
            ref={(element) => {
              const rect = reactFlowMock.nodeRects[node.id];
              if (element && rect) element.getBoundingClientRect = () => rect;
            }}
            onClick={(event) => {
              const isMultiSelect = event.ctrlKey || event.metaKey;
              const selectedNodeIds = new Set<string>();

              if (isMultiSelect) {
                props.nodes?.forEach((candidate) => {
                  if (candidate.selected) selectedNodeIds.add(candidate.id);
                });
                if (node.selected) {
                  selectedNodeIds.delete(node.id);
                } else {
                  selectedNodeIds.add(node.id);
                }
                props.onNodesChange?.([
                  { id: node.id, type: 'select', selected: !node.selected },
                ]);
              } else {
                selectedNodeIds.add(node.id);
                props.onNodesChange?.(
                  props.nodes?.map((candidate) => ({
                    id: candidate.id,
                    type: 'select',
                    selected: candidate.id === node.id,
                  })) ?? []
                );
                props.onEdgesChange?.(
                  props.edges
                    ?.filter((edge) => edge.selected)
                    .map((edge) => ({ id: edge.id, type: 'select', selected: false })) ?? []
                );
              }

              props.onNodeClick?.(event, node);
              props.onSelectionChange?.({
                nodes: props.nodes?.filter((candidate) => selectedNodeIds.has(candidate.id)) ?? [],
                edges: [],
              });
            }}
          >
            {node.data?.label ?? node.id}
          </button>
        ))}
        {props.edges?.map((edge) => (
          <div
            key={edge.id}
            data-testid={`rf__edge-${edge.id}`}
            data-id={edge.id}
            className={`react-flow__edge${edge.selected ? ' selected' : ''}`}
            ref={(element) => {
              const rect = reactFlowMock.edgeRects[edge.id];
              if (element && rect) element.getBoundingClientRect = () => rect;
            }}
          />
        ))}
        {reactFlowMock.selectionRect && (
          <div
            className="react-flow__selection"
            ref={(element) => {
              if (element && reactFlowMock.selectionRect) {
                element.getBoundingClientRect = () => reactFlowMock.selectionRect as DOMRect;
              }
            }}
          />
        )}
        {props.children}
      </div>
    );
  },
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ConnectionMode: { Loose: 'loose' },
  SelectionMode: { Partial: 'partial' },
  addEdge: vi.fn((_edge, edges) => edges),
  applyNodeChanges: vi.fn((changes, nodes) =>
    nodes.map((node: Record<string, any>) => {
      const selectChange = changes.find(
        (change: Record<string, any>) => change.type === 'select' && change.id === node.id
      );
      return selectChange
        ? { ...node, selected: selectChange.selected }
        : node;
    })
  ),
  applyEdgeChanges: vi.fn((changes, edges) =>
    edges.map((edge: Record<string, any>) => {
      const selectChange = changes.find(
        (change: Record<string, any>) => change.type === 'select' && change.id === edge.id
      );
      return selectChange
        ? { ...edge, selected: selectChange.selected }
        : edge;
    })
  ),
  useReactFlow: () => ({
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    fitView: reactFlowMock.fitView,
    getZoom: () => 1,
    setCenter: reactFlowMock.setCenter,
  }),
}));

describe('BehaviorTreePanel', () => {
  beforeEach(() => {
    reactFlowMock.render.mockClear();
    reactFlowMock.nodes = [];
    reactFlowMock.edges = [];
    reactFlowMock.nodeRects = {};
    reactFlowMock.edgeRects = {};
    reactFlowMock.selectionRect = null;
    reactFlowMock.setCenter.mockReset();
    reactFlowMock.fitView.mockReset();
    localStorage.clear();
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
      expect.objectContaining({
        connectionRadius: 48,
        selectionMode: 'partial',
        multiSelectionKeyCode: ['Control', 'Meta'],
        panOnDrag: true,
        selectionOnDrag: false,
      })
    );
  });

  it('offers a responsive tree arrangement action', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.getByRole('button', { name: 'Arrange tree' })).toBeInTheDocument();
  });

  it('switches between pan and box-select canvas modes', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(reactFlowMock.render.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        panOnDrag: true,
        selectionOnDrag: false,
      })
    );

    fireEvent.click(screen.getByTestId('bt-select-mode'));

    expect(reactFlowMock.render.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        panOnDrag: false,
        selectionOnDrag: false,
      })
    );
    expect(screen.getByTestId('bt-select-mode')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('bt-pan-mode'));

    expect(reactFlowMock.render.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        panOnDrag: true,
        selectionOnDrag: false,
      })
    );
    expect(screen.getByTestId('bt-pan-mode')).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles an edge click without crashing', () => {
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
    expect(reactFlowMock.render).toHaveBeenCalled();
  });

  it('keeps multiple nodes highlighted after Ctrl-click selection', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'ctrl-selection-tree',
            name: 'Ctrl Selection Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Ctrl Selection Tree'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');

    fireEvent.click(nodeA);
    await waitFor(() => expect(nodeA).toHaveAttribute('data-highlighted', 'true'));

    fireEvent.click(nodeB, { ctrlKey: true });

    await waitFor(() => {
      expect(nodeA).toHaveAttribute('data-highlighted', 'true');
      expect(nodeB).toHaveAttribute('data-highlighted', 'true');
    });
  });

  it('centers a saved tree after opening it', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'center-tree',
            name: 'Center Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 840, y: 620 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Center Tree'));

    await screen.findByTestId('rf-node-node-a');
    await waitFor(() => {
      expect(reactFlowMock.fitView).toHaveBeenCalledWith(
        expect.objectContaining({ padding: 0.22, maxZoom: 1.1 })
      );
    });
  });

  it('keeps the selected node layout inside a wrapped subtree', async () => {
    const now = Date.now();
    const nodeAPosition = { x: 37, y: 123 };
    const nodeBPosition = { x: 312, y: -48 };
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'wrap-layout-tree',
            name: 'Wrap Layout Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: nodeAPosition,
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: nodeBPosition,
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Wrap Layout Tree'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');
    fireEvent.click(nodeA);
    fireEvent.click(nodeB, { ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      const subtreeNode = latestProps.nodes.find((node) => node.type === 'subtree');
      expect(subtreeNode).toBeTruthy();
      const embeddedNodes = subtreeNode?.data?.tree?.nodes as Array<Record<string, any>>;
      const anchor = {
        x: (nodeAPosition.x + nodeBPosition.x) / 2,
        y: (nodeAPosition.y + nodeBPosition.y) / 2,
      };
      expect(embeddedNodes.find((node) => node.id === 'node-a')?.position).toEqual({
        x: nodeAPosition.x - anchor.x,
        y: nodeAPosition.y - anchor.y,
      });
      expect(embeddedNodes.find((node) => node.id === 'node-b')?.position).toEqual({
        x: nodeBPosition.x - anchor.x,
        y: nodeBPosition.y - anchor.y,
      });
    });
  });

  it('undoes and redoes subtree wrapping with keyboard shortcuts', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'redo-wrap-tree',
            name: 'Redo Wrap Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    expect(screen.getByTestId('bt-redo')).toBeDisabled();
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Redo Wrap Tree'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');
    fireEvent.click(nodeA);
    fireEvent.click(nodeB, { ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.some((node) => node.type === 'subtree')).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.some((node) => node.type === 'subtree')).toBe(false);
      expect(screen.getByTestId('bt-redo')).toBeEnabled();
    });

    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.some((node) => node.type === 'subtree')).toBe(true);
      expect(screen.getByTestId('bt-redo')).toBeDisabled();
    });
  });

  it('restores the previous root tree after loading a saved tree and undoing', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'loaded-tree',
            name: 'Loaded Tree',
            nodes: [
              {
                id: 'node-loaded',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Loaded Action', actionName: '/loaded', actionType: 'example/Loaded' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Loaded Tree'));

    await screen.findByTestId('rf-node-node-loaded');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes).toHaveLength(0);
    });
    expect(screen.getByTestId('bt-redo')).toBeEnabled();
  });

  it('restores the previous tree after creating a new tree and undoing', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'new-undo-source',
            name: 'New Undo Source',
            nodes: [
              {
                id: 'node-existing',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Existing Action', actionName: '/existing', actionType: 'example/Existing' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('New Undo Source'));
    await screen.findByTestId('rf-node-node-existing');

    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('New'));

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes).toHaveLength(0);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.map((node) => node.id)).toContain('node-existing');
    });
  });

  it('undoes a newly created subtree from inside that subtree without leaving a broken path', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'subtree-path-undo',
            name: 'Subtree Path Undo',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Subtree Path Undo'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');
    fireEvent.click(nodeA);
    fireEvent.click(nodeB, { ctrlKey: true });

    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));
    await waitFor(() => expect(screen.getByTestId('bt-context-open-subtree')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-open-subtree'));
    await waitFor(() => expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument());

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['node-a', 'node-b']));
      expect(latestProps.nodes.some((node) => node.type === 'subtree')).toBe(false);
    });
    expect(screen.queryByTestId('bt-subtree-parent')).not.toBeInTheDocument();
  });

  it('keeps the active subtree path when undoing an edit made inside the subtree', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'subtree-edit-undo',
            name: 'Subtree Edit Undo',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Subtree Edit Undo'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');
    fireEvent.click(nodeA);
    fireEvent.click(nodeB, { ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));
    await waitFor(() => expect(screen.getByTestId('bt-context-open-subtree')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-open-subtree'));
    await waitFor(() => expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.some((node) => node.type === 'retry')).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['node-a', 'node-b']));
      expect(latestProps.nodes).toHaveLength(2);
      expect(latestProps.nodes.some((node) => node.type === 'retry')).toBe(false);
    });
    expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument();
  });

  it('does not keep a box-selected edge unless both endpoint nodes are selected', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'partial-edge-tree',
            name: 'Partial Edge Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', type: 'sequence' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b', animated: true }],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Partial Edge Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      nodes: Array<Record<string, any>>;
      edges: Array<Record<string, any>>;
      onSelectionStart: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };
    const nodeA = props.nodes.find((node) => node.id === 'node-a');
    const edge = props.edges.find((candidate) => candidate.id === 'edge-a-b');
    expect(nodeA).toBeTruthy();
    expect(edge).toBeTruthy();

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({ nodes: [nodeA as Record<string, any>], edges: [edge as Record<string, any>] });
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).not.toBe(true);
    });
  });

  it('keeps only geometrically enclosed links when the selection box is measurable', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'geometry-edge-tree',
            name: 'Geometry Edge Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', type: 'sequence' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
              {
                id: 'node-c',
                type: 'action',
                position: { x: 440, y: 0 },
                data: { label: 'Node C', actionName: '/c', actionType: 'example/C' },
              },
            ],
            edges: [
              { id: 'edge-a-b', source: 'node-a', target: 'node-b', animated: true },
              { id: 'edge-a-c', source: 'node-a', target: 'node-c', animated: true },
            ],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );
    reactFlowMock.selectionRect = createRect(0, 0, 100, 100);
    reactFlowMock.edgeRects = {
      'edge-a-b': createRect(20, 20, 40, 30),
      'edge-a-c': createRect(20, 20, 160, 30),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Geometry Edge Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      nodes: Array<Record<string, any>>;
      edges: Array<Record<string, any>>;
      onSelectionStart: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({ nodes: props.nodes, edges: props.edges });
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-c')?.selected).not.toBe(true);
    });
  });

  it('uses selection geometry when React Flow misses partially covered nodes', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'partial-node-geometry-tree',
            name: 'Partial Node Geometry Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );
    reactFlowMock.selectionRect = createRect(95, 0, 80, 100);
    reactFlowMock.nodeRects = {
      'node-a': createRect(10, 10, 100, 70),
      'node-b': createRect(130, 10, 100, 70),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Partial Node Geometry Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      nodes: Array<Record<string, any>>;
      onSelectionStart: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };
    const nodeA = props.nodes.find((node) => node.id === 'node-a');
    expect(nodeA).toBeTruthy();

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({ nodes: [nodeA as Record<string, any>], edges: [] });
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
    });
  });

  it('keeps an enclosed link selected when the selection box is gone at release', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'release-link-tree',
            name: 'Release Link Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', type: 'sequence' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b', animated: true }],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );
    reactFlowMock.selectionRect = createRect(0, 0, 120, 120);
    reactFlowMock.edgeRects = {
      'edge-a-b': createRect(20, 20, 40, 30),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Release Link Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      onSelectionStart: () => void;
      onSelectionEnd: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({ nodes: [], edges: [] });
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
    });

    const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
      onSelectionEnd: () => void;
    };
    act(() => {
      reactFlowMock.selectionRect = null;
      latestProps.onSelectionEnd();
    });

    await waitFor(() => {
      const finalProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(finalProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
    });
  });

  it('ignores the stale empty selection event that can follow box release', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'late-clear-tree',
            name: 'Late Clear Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Late Clear Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      nodes: Array<Record<string, any>>;
      onPaneClick: () => void;
      onSelectionStart: () => void;
      onSelectionEnd: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };
    const nodeA = props.nodes.find((node) => node.id === 'node-a');
    const nodeB = props.nodes.find((node) => node.id === 'node-b');
    expect(nodeA).toBeTruthy();
    expect(nodeB).toBeTruthy();

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({
        nodes: [nodeA as Record<string, any>, nodeB as Record<string, any>],
        edges: [],
      });
      props.onSelectionEnd();
    });

    await waitFor(() => expect(screen.getByTestId('bt-selection-actions')).toBeInTheDocument());

    const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
      onPaneClick: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };
    act(() => {
      latestProps.onSelectionChange({ nodes: [], edges: [] });
      latestProps.onPaneClick();
    });

    await waitFor(() => {
      const finalProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(finalProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(finalProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
    });
    expect(screen.getByTestId('bt-selection-actions')).toBeInTheDocument();
  });

  it('keeps box-selected nodes and enclosed links highlighted after release updates', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'box-selection-tree',
            name: 'Box Selection Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', type: 'sequence' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b', animated: true }],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Box Selection Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      nodes: Array<Record<string, any>>;
      edges: Array<Record<string, any>>;
      onNodesChange: (changes: Array<Record<string, any>>) => void;
      onEdgesChange: (changes: Array<Record<string, any>>) => void;
      onSelectionStart: () => void;
      onSelectionEnd: () => void;
      onSelectionChange: (selection: {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      }) => void;
    };
    const nodeA = props.nodes.find((node) => node.id === 'node-a');
    const nodeB = props.nodes.find((node) => node.id === 'node-b');
    const edge = props.edges.find((candidate) => candidate.id === 'edge-a-b');
    expect(nodeA).toBeTruthy();
    expect(nodeB).toBeTruthy();
    expect(edge).toBeTruthy();

    act(() => {
      props.onSelectionStart();
      props.onSelectionChange({
        nodes: [nodeA as Record<string, any>, nodeB as Record<string, any>],
        edges: [edge as Record<string, any>],
      });
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
    });

    const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
      onNodesChange: (changes: Array<Record<string, any>>) => void;
      onEdgesChange: (changes: Array<Record<string, any>>) => void;
      onSelectionEnd: () => void;
    };

    act(() => {
      latestProps.onNodesChange([
        { id: 'node-a', type: 'select', selected: true },
        { id: 'node-b', type: 'select', selected: true },
      ]);
      latestProps.onEdgesChange([{ id: 'edge-a-b', type: 'select', selected: false }]);
      latestProps.onSelectionEnd();
    });

    await waitFor(() => {
      const finalProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      };
      expect(finalProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(finalProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
      expect(finalProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
    });
  });

  it('selects an enclosed link when a box drag adds the second endpoint without another edge event', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'box-edge-count-tree',
            name: 'Box Edge Count Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', type: 'sequence' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [{ id: 'edge-a-b', source: 'node-a', target: 'node-b', animated: true }],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Box Edge Count Tree'));

    await screen.findByTestId('rf-node-node-a');
    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      onNodesChange: (changes: Array<Record<string, any>>) => void;
      onEdgesChange: (changes: Array<Record<string, any>>) => void;
      onSelectionStart: () => void;
    };

    act(() => {
      props.onSelectionStart();
      props.onNodesChange([{ id: 'node-a', type: 'select', selected: true }]);
      props.onEdgesChange([{ id: 'edge-a-b', type: 'select', selected: true }]);
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).not.toBe(true);
    });

    const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
      onNodesChange: (changes: Array<Record<string, any>>) => void;
    };

    act(() => {
      latestProps.onNodesChange([
        { id: 'node-a', type: 'select', selected: true },
        { id: 'node-b', type: 'select', selected: true },
      ]);
    });

    await waitFor(() => {
      const finalProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      };
      expect(finalProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(finalProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
      expect(finalProps.edges.find((candidate) => candidate.id === 'edge-a-b')?.selected).toBe(true);
    });
  });

  it('hides contextual selection actions immediately when a new area selection starts', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'context-actions-tree',
            name: 'Context Actions Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Context Actions Tree'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    fireEvent.click(nodeA);

    await waitFor(() => expect(screen.getByTestId('bt-duplicate-selected')).toBeInTheDocument());

    const props = reactFlowMock.render.mock.lastCall?.[0] as {
      onSelectionStart: () => void;
    };

    act(() => {
      props.onSelectionStart();
    });

    expect(screen.queryByTestId('bt-duplicate-selected')).not.toBeInTheDocument();
    await waitFor(() => expect(nodeA).toHaveAttribute('data-highlighted', 'false'));
  });

  it('keeps custom box selection alive while dragging across nodes', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'early-end-tree',
            name: 'Early End Tree',
            nodes: [
              {
                id: 'node-a',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Node A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'node-b',
                type: 'action',
                position: { x: 220, y: 0 },
                data: { label: 'Node B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );
    reactFlowMock.nodeRects = {
      'node-a': createRect(30, 30, 100, 70),
      'node-b': createRect(210, 45, 100, 70),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-select-mode'));
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Early End Tree'));

    await screen.findByTestId('rf-node-node-a');
    const flow = screen.getByTestId('mock-react-flow');
    fireEvent.pointerDown(flow, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(flow, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 95,
      clientY: 80,
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).not.toBe(true);
    });
    expect(screen.getByTestId('bt-custom-selection')).toBeInTheDocument();

    fireEvent.pointerMove(flow, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 140,
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
    });

    fireEvent.pointerUp(flow, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 340,
      clientY: 140,
    });
    await waitFor(() => expect(screen.getByTestId('bt-selection-actions')).toBeInTheDocument());
    expect(screen.queryByTestId('bt-custom-selection')).not.toBeInTheDocument();
  });

  it('edits retry and repeat counts from the contextual action', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'iteration-tree',
            name: 'Iteration Tree',
            nodes: [
              {
                id: 'node-retry',
                type: 'retry',
                position: { x: 0, y: 0 },
                data: { label: 'Retry', type: 'retry', iterationLimit: 3 },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Iteration Tree'));

    const retryNode = await screen.findByTestId('rf-node-node-retry');
    fireEvent.click(retryNode);

    await waitFor(() => expect(screen.getByTestId('bt-configure-iteration')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-configure-iteration'));
    fireEvent.change(screen.getByLabelText('Attempts'), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-retry')?.data?.iterationLimit).toBe(-1);
    });
  });
});
