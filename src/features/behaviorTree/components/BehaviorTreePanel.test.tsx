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

const executorMock = vi.hoisted(() => ({
  instances: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    callback: (event: Record<string, unknown>) => void;
  }>,
}));

const rosDiscoveryMock = vi.hoisted(() => ({
  discoverAllROSResources: vi.fn(),
  fetchActionGoalDetails: vi.fn(),
  fetchServiceRequestSchema: vi.fn(),
}));

const agentClientMock = vi.hoisted(() => ({
  generateBehaviorTree: vi.fn(),
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

const createMatchMedia =
  (matches: boolean) =>
  (query: string): MediaQueryList => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList);

const firePointerEvent = (
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: {
    pointerId?: number;
    pointerType?: string;
    button?: number;
    buttons?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    clientX: number;
    clientY: number;
  }
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const eventInit = {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    ...init,
  };

  Object.entries(eventInit).forEach(([key, value]) => {
    Object.defineProperty(event, key, {
      configurable: true,
      enumerable: true,
      value,
    });
  });
  fireEvent(element, event);
};

const dispatchWindowPointerEvent = (
  type: 'pointermove' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; pointerId?: number }
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.entries({
    pointerId: 1,
    ...init,
  }).forEach(([key, value]) => {
    Object.defineProperty(event, key, {
      configurable: true,
      enumerable: true,
      value,
    });
  });
  window.dispatchEvent(event);
};

const ctrlClickNode = (element: Element) => {
  firePointerEvent(element, 'pointerdown', {
    clientX: 0,
    clientY: 0,
    ctrlKey: true,
  });
  fireEvent.click(element, { ctrlKey: true });
};

vi.mock('../engine/executor', () => ({
  BehaviorTreeExecutor: vi.fn().mockImplementation(
    function MockBehaviorTreeExecutor(
      this: {
        start: ReturnType<typeof vi.fn>;
        pause: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        callback: (event: Record<string, unknown>) => void;
      },
      _tree: unknown,
      _ros: unknown,
      callback: (event: Record<string, unknown>) => void
    ) {
      const instance = {
        start: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
        callback,
      };
      executorMock.instances.push(instance);
      this.start = instance.start;
      this.pause = instance.pause;
      this.resume = instance.resume;
      this.stop = instance.stop;
      this.callback = instance.callback;
      return instance;
    }
  ),
}));

vi.mock('../services/rosDiscovery', () => rosDiscoveryMock);
vi.mock('../agent/agentClient', () => agentClientMock);

vi.mock('reactflow', () => ({
  default: (props: {
    children?: React.ReactNode;
    nodes?: Array<Record<string, any>>;
    edges?: Array<Record<string, any>>;
    onNodeClick?: (event: React.MouseEvent, node: Record<string, any>) => void;
    onEdgeClick?: (event: React.MouseEvent, edge: Record<string, any>) => void;
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
            onClick={(event) => {
              props.onEdgeClick?.(event, edge);
              props.onSelectionChange?.({
                nodes: [],
                edges: props.edges?.filter((candidate) => candidate.id === edge.id) ?? [],
              });
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
    executorMock.instances = [];
    rosDiscoveryMock.discoverAllROSResources.mockReset();
    rosDiscoveryMock.fetchActionGoalDetails.mockReset();
    rosDiscoveryMock.fetchServiceRequestSchema.mockReset();
    agentClientMock.generateBehaviorTree.mockReset();
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({ actions: [], services: [], topics: [] });
    rosDiscoveryMock.fetchActionGoalDetails.mockResolvedValue(null);
    rosDiscoveryMock.fetchServiceRequestSchema.mockResolvedValue(null);
    agentClientMock.generateBehaviorTree.mockResolvedValue(JSON.stringify({
      name: 'Generated',
      nodes: [{ id: 'generated-root', type: 'sequence', label: 'Generated root' }],
      edges: [],
    }));
    window.matchMedia = createMatchMedia(false);
    window.confirm = vi.fn(() => true);
    localStorage.clear();
  });

  it('does not open the node palette until the user toggles it', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    expect(screen.queryByTestId('bt-node-palette')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));

    expect(screen.getByTestId('bt-node-palette')).toBeInTheDocument();
  });

  it('opens and closes the AI behavior tree agent', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    fireEvent.click(screen.getByTestId('bt-open-agent'));
    expect(screen.getByTestId('bt-agent-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Describe the behavior')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate tree' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Close AI agent' }));
    expect(screen.queryByTestId('bt-agent-panel')).not.toBeInTheDocument();
  });

  it('opens a compact inline agent instruction at the canvas pointer with Ctrl+I', async () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    fireEvent.pointerMove(screen.getByTestId('bt-canvas'), { clientX: 240, clientY: 180 });
    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });

    const prompt = await screen.findByLabelText('Inline AI instruction');
    await waitFor(() => expect(prompt).toHaveFocus());
    expect(screen.queryByTestId('bt-agent-panel')).not.toBeInTheDocument();

    fireEvent.change(prompt, { target: { value: 'Add a stop action to this sequence' } });
    fireEvent.submit(prompt.closest('form')!);

    expect(await screen.findByTestId('bt-agent-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Describe the behavior')).toHaveValue('Add a stop action to this sequence');
  });

  it('previews agent changes on the canvas and accepts them from the popup', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'agent-current-tree',
            name: 'Agent Current Tree',
            nodes: [
              {
                id: 'root',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Root', type: 'sequence' },
              },
              {
                id: 'move',
                type: 'action',
                position: { x: 0, y: 120 },
                data: { label: 'Move', actionName: '/move', actionType: 'robot/action/Move', parameters: { x: 0 } },
              },
            ],
            edges: [{ id: 'root-move', source: 'root', target: 'move' }],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );
    rosDiscoveryMock.discoverAllROSResources.mockResolvedValue({
      actions: [{ name: '/move', type: 'robot/action/Move', namespace: '/move' }],
      services: [],
      topics: [],
    });
    agentClientMock.generateBehaviorTree.mockResolvedValue(JSON.stringify({
      name: 'Accepted Agent Tree',
      description: 'Move farther',
      nodes: [
        { id: 'root', type: 'sequence', label: 'Root' },
        { id: 'move', type: 'action', label: 'Move', config: { actionName: '/move', actionType: 'robot/action/Move', parameters: { x: 1, y: 0 } } },
        { id: 'wait', type: 'timeout', label: 'Wait', config: { timeout: 500 } },
      ],
      edges: [
        { source: 'root', target: 'move' },
        { source: 'root', target: 'wait' },
      ],
    }));

    render(<BehaviorTreePanel ros={{} as any} isConnected isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Agent Current Tree'));
    await screen.findByTestId('rf-node-move');

    fireEvent.click(screen.getByTestId('bt-open-agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Scan ROS resources' }));
    await screen.findByText('1 resources · 0 input schemas');
    fireEvent.change(screen.getByLabelText('Describe the behavior'), { target: { value: 'Move one meter and wait' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate tree' }));

    const banner = await screen.findByTestId('bt-agent-canvas-preview-banner');
    expect(banner).toHaveTextContent('Agent preview');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add subtree' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    await waitFor(() => {
      expect(reactFlowMock.fitView).toHaveBeenCalledWith(expect.objectContaining({ padding: 0.2, maxZoom: 1.15 }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => {
      expect(screen.queryByTestId('bt-agent-canvas-preview-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('bt-agent-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('rf-node-wait')).toBeInTheDocument();
    });
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

  it('places contextual node actions below the selected node on mobile when there is room', async () => {
    window.matchMedia = createMatchMedia(true);
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'mobile-actions-tree',
            name: 'Mobile Actions Tree',
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
    reactFlowMock.nodeRects = {
      'node-a': createRect(120, 140, 165, 82),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    const canvas = document.querySelector('.bt-canvas') as HTMLElement;
    canvas.getBoundingClientRect = () => createRect(0, 0, 375, 640);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Mobile Actions Tree'));

    fireEvent.click(await screen.findByTestId('rf-node-node-a'));

    const actions = await screen.findByTestId('bt-selection-actions');
    expect(actions).toHaveClass('placement-below');
    expect(parseFloat(actions.style.top)).toBe(236);
  });

  it('places contextual node actions above a selected node near the bottom on mobile', async () => {
    window.matchMedia = createMatchMedia(true);
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'mobile-bottom-actions-tree',
            name: 'Mobile Bottom Actions Tree',
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
    reactFlowMock.nodeRects = {
      'node-a': createRect(120, 220, 165, 70),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    const canvas = document.querySelector('.bt-canvas') as HTMLElement;
    canvas.getBoundingClientRect = () => createRect(0, 0, 375, 300);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Mobile Bottom Actions Tree'));

    fireEvent.click(await screen.findByTestId('rf-node-node-a'));

    const actions = await screen.findByTestId('bt-selection-actions');
    expect(actions).toHaveClass('placement-above');
    expect(parseFloat(actions.style.top)).toBe(206);
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

  it('resizes the behavior tree menu from a corner', () => {
    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);

    fireEvent.click(screen.getByTestId('bt-menu-button'));

    const overlay = document.querySelector('.bt-menu-overlay') as HTMLElement;
    const menuPanel = screen.getByTestId('bt-menu-panel');
    overlay.getBoundingClientRect = () => createRect(0, 0, 600, 500);
    menuPanel.getBoundingClientRect = () => createRect(12, 56, 280, 300);

    firePointerEvent(screen.getByLabelText('Resize menu from se corner'), 'pointerdown', {
      clientX: 292,
      clientY: 356,
    });

    act(() => {
      dispatchWindowPointerEvent('pointermove', { clientX: 352, clientY: 396 });
    });

    expect(menuPanel).toHaveStyle({ width: '340px', height: '340px' });

    act(() => {
      dispatchWindowPointerEvent('pointerup', { clientX: 352, clientY: 396 });
    });
  });

  it('toggles follow mode and centers the running node while executing', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'follow-tree',
            name: 'Follow Tree',
            nodes: [
              {
                id: 'node-follow',
                type: 'action',
                position: { x: 480, y: 360 },
                width: 180,
                height: 70,
                data: { label: 'Follow Action', actionName: '/follow', actionType: 'example/Follow' },
              },
            ],
            edges: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={{} as any} isConnected isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Follow Tree'));
    await screen.findByTestId('rf-node-node-follow');

    fireEvent.click(screen.getByTestId('bt-follow-mode'));
    expect(screen.getByTestId('bt-follow-mode')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(executorMock.instances).toHaveLength(1);

    act(() => {
      executorMock.instances[0].callback({
        type: 'nodeRunning',
        nodeId: 'node-follow',
        timestamp: Date.now(),
        data: { status: 'running', treePath: [] },
      });
    });

    await waitFor(() => {
      expect(reactFlowMock.setCenter).toHaveBeenCalledWith(
        570,
        395,
        expect.objectContaining({ zoom: 1, duration: 360 })
      );
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled();
    expect(screen.getByTestId('bt-menu-button')).toBeDisabled();
    expect(screen.getByTestId('bt-palette-toggle')).toBeDisabled();
    expect(reactFlowMock.render.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        nodesDraggable: false,
        nodesConnectable: false,
        deleteKeyCode: null,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(executorMock.instances[0].pause).toHaveBeenCalledOnce();
    act(() => {
      executorMock.instances[0].callback({ type: 'paused', timestamp: Date.now() });
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(executorMock.instances[0].resume).toHaveBeenCalledOnce();
    act(() => {
      executorMock.instances[0].callback({ type: 'resumed', timestamp: Date.now() });
    });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(executorMock.instances[0].stop).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(screen.getByTestId('bt-menu-button')).toBeEnabled();

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
      props.onEdgeClick(
        {
          ctrlKey: false,
          metaKey: false,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.MouseEvent,
        reactFlowMock.edges[0]
      );
    });
    expect(reactFlowMock.render).toHaveBeenCalled();
  });

  it('keeps multiple links selected after Ctrl-clicking edges', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'ctrl-edge-tree',
            name: 'Ctrl Edge Tree',
            nodes: [
              {
                id: 'root',
                type: 'sequence',
                position: { x: 0, y: 0 },
                data: { label: 'Root', type: 'sequence' },
              },
              {
                id: 'child-a',
                type: 'action',
                position: { x: 0, y: 120 },
                data: { label: 'Child A', actionName: '/a', actionType: 'example/A' },
              },
              {
                id: 'child-b',
                type: 'action',
                position: { x: 220, y: 120 },
                data: { label: 'Child B', actionName: '/b', actionType: 'example/B' },
              },
            ],
            edges: [
              { id: 'edge-root-a', source: 'root', target: 'child-a', animated: true },
              { id: 'edge-root-b', source: 'root', target: 'child-b', animated: true },
            ],
            createdAt: now,
            updatedAt: now,
          },
        },
      ])
    );

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Ctrl Edge Tree'));

    const edgeA = await screen.findByTestId('rf__edge-edge-root-a');
    const edgeB = await screen.findByTestId('rf__edge-edge-root-b');

    fireEvent.click(edgeA);
    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((edge) => edge.id === 'edge-root-a')?.selected).toBe(true);
      expect(latestProps.edges.find((edge) => edge.id === 'edge-root-b')?.selected).not.toBe(true);
    });

    fireEvent.click(edgeB, { ctrlKey: true });
    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
        edges: Array<Record<string, any>>;
      };
      expect(latestProps.edges.find((edge) => edge.id === 'edge-root-a')?.selected).toBe(true);
      expect(latestProps.edges.find((edge) => edge.id === 'edge-root-b')?.selected).toBe(true);
      expect(latestProps.nodes.some((node) => node.selected)).toBe(false);
    });
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

    ctrlClickNode(nodeB);

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
    ctrlClickNode(nodeB);

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
    ctrlClickNode(nodeB);

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
    await waitFor(() => expect(screen.getByTestId('bt-undo')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('bt-undo'));

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
    ctrlClickNode(nodeB);

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
    ctrlClickNode(nodeB);
    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));
    await waitFor(() => expect(screen.getByTestId('bt-context-open-subtree')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-open-subtree'));
    await waitFor(() => expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument());

    let subtreeNodeCountBeforeRetry = 0;
    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['node-a', 'node-b']));
      subtreeNodeCountBeforeRetry = latestProps.nodes.length;
      expect(subtreeNodeCountBeforeRetry).toBeGreaterThanOrEqual(2);
    });

    fireEvent.click(screen.getByTestId('bt-palette-toggle'));
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.some((node) => node.type === 'retry')).toBe(true);
    });

    await waitFor(() => expect(screen.getByTestId('bt-undo')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('bt-undo'));

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['node-a', 'node-b']));
      expect(latestProps.nodes).toHaveLength(subtreeNodeCountBeforeRetry);
      expect(latestProps.nodes.some((node) => node.type === 'retry')).toBe(false);
    });
    expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument();
  });

  it('opens a saved tree as a root tree when currently inside a subtree', async () => {
    const now = Date.now();
    localStorage.setItem(
      'robo-boy-behavior-trees',
      JSON.stringify([
        {
          version: '1.0.0',
          tree: {
            id: 'subtree-load-source',
            name: 'Subtree Load Source',
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
        {
          version: '1.0.0',
          tree: {
            id: 'fresh-root-tree',
            name: 'Fresh Root Tree',
            nodes: [
              {
                id: 'node-root',
                type: 'action',
                position: { x: 0, y: 0 },
                data: { label: 'Fresh Root Action', actionName: '/root', actionType: 'example/Root' },
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
    fireEvent.click(screen.getByText('Subtree Load Source'));

    const nodeA = await screen.findByTestId('rf-node-node-a');
    const nodeB = await screen.findByTestId('rf-node-node-b');
    fireEvent.click(nodeA);
    ctrlClickNode(nodeB);
    await waitFor(() => expect(screen.getByTestId('bt-context-wrap')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-wrap'));
    await waitFor(() => expect(screen.getByTestId('bt-context-open-subtree')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('bt-context-open-subtree'));
    await waitFor(() => expect(screen.getByTestId('bt-subtree-parent')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Fresh Root Tree'));

    await screen.findByTestId('rf-node-node-root');
    expect(screen.queryByTestId('bt-subtree-parent')).not.toBeInTheDocument();
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
      'node-a': createRect(80, 80, 100, 70),
      'node-b': createRect(260, 95, 100, 70),
    };

    render(<BehaviorTreePanel ros={null} isConnected={false} isActive />);
    fireEvent.click(screen.getByTestId('bt-select-mode'));
    await waitFor(() => expect(screen.getByTestId('bt-select-mode')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByTestId('bt-menu-button'));
    fireEvent.click(screen.getByText('Early End Tree'));

    await screen.findByTestId('rf-node-node-a');
    await waitFor(() => {
      expect(reactFlowMock.render.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          panOnDrag: false,
          selectionOnDrag: false,
        })
      );
    });
    const flow = screen.getByTestId('mock-react-flow');
    firePointerEvent(flow, 'pointerdown', {
      clientX: 40,
      clientY: 40,
    });
    firePointerEvent(flow, 'pointermove', {
      clientX: 190,
      clientY: 160,
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).not.toBe(true);
    });
    expect(screen.getByTestId('bt-custom-selection')).toBeInTheDocument();

    firePointerEvent(flow, 'pointermove', {
      clientX: 390,
      clientY: 190,
    });

    await waitFor(() => {
      const latestProps = reactFlowMock.render.mock.lastCall?.[0] as {
        nodes: Array<Record<string, any>>;
      };
      expect(latestProps.nodes.find((node) => node.id === 'node-a')?.data?.isHighlighted).toBe(true);
      expect(latestProps.nodes.find((node) => node.id === 'node-b')?.data?.isHighlighted).toBe(true);
    });

    firePointerEvent(flow, 'pointerup', {
      clientX: 390,
      clientY: 190,
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
