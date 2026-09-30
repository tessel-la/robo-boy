import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoboBoyJsonObject } from '../../panels/types';
import type { ReplaySession } from '../recordReplay/ReplaySession';
import type { InspectionSnapshot, Resource } from './types';

const fake = vi.hoisted(() => ({
  snapshot: undefined as unknown as InspectionSnapshot,
  listeners: new Set<() => void>(),
  acquire: vi.fn(() => () => undefined),
  update: vi.fn(),
  refresh: vi.fn(),
  recordEvent: vi.fn(),
  fitView: vi.fn(),
}));

vi.mock('./InspectionSession', async importOriginal => {
  const actual = await importOriginal<typeof import('./InspectionSession')>();
  return {
    ...actual,
    getInspectionSession: () => ({
      subscribe: (listener: () => void) => {
        fake.listeners.add(listener);
        return () => fake.listeners.delete(listener);
      },
      getSnapshot: () => fake.snapshot,
      acquire: fake.acquire,
      update: fake.update,
      refresh: fake.refresh,
      recordEvent: fake.recordEvent,
    }),
  };
});

// React Flow needs a real layout engine; a flat list of nodes is enough to exercise the graph view.
vi.mock('reactflow', async () => {
  const { useState: useLocalState } = await import('react');
  return {
    default: (props: {
      nodes: { id: string; data: { label: ReactNode } }[];
      edges: { id: string; className?: string }[];
      children?: ReactNode;
      onInit?: (instance: { fitView: () => void }) => void;
      onNodeClick?: (event: unknown, node: { id: string }) => void;
      onNodeDragStop?: (event: unknown, node: { id: string; position: { x: number; y: number } }) => void;
    }) => {
      props.onInit?.({ fitView: fake.fitView });
      return (
        <div data-testid="flow">
          {props.nodes.map(node => (
            <span key={node.id}>
              <button onClick={event => props.onNodeClick?.(event, node)}>{node.data.label}</button>
              <button
                aria-label={`Drag ${node.id}`}
                onClick={event => props.onNodeDragStop?.(event, { ...node, position: { x: 5, y: 7 } })}
              />
            </span>
          ))}
          <span data-testid="edges">{props.edges.map(edge => `${edge.id}:${edge.className ?? ''}`).join('|')}</span>
          {props.children}
        </div>
      );
    },
    Background: () => null,
    Controls: () => null,
    BackgroundVariant: { Dots: 'dots' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    useNodesState: <T,>(initial: T[]) => {
      const [nodes, setNodes] = useLocalState(initial);
      return [nodes, setNodes, () => undefined] as const;
    },
  };
});

import DataExplorerPanel, { type ExplorerOpenRequest } from './DataExplorerPanel';
import { emptySnapshot } from './InspectionSession';
import { getDataExplorerPresentation } from './presentation';

const NOW = 1_700_000_000_000;
const topic = (name: string, type: string, patch: Partial<Resource> = {}): Resource => ({
  id: `topic:${name}`,
  kind: 'topic',
  name,
  types: [type],
  providers: [],
  consumers: [],
  countKind: 'endpoints',
  ...patch,
});

function liveSnapshot(): InspectionSnapshot {
  return {
    ...emptySnapshot(),
    mode: 'host',
    online: true,
    loading: false,
    updatedAt: NOW,
    now: NOW,
    truncated: true,
    errors: ['/broken: probe failed'],
    resources: [
      topic('/scan', 'sensor_msgs/msg/LaserScan', {
        providers: ['/lidar'],
        consumers: ['/nav', '/ui', '/roboboy_inspector'],
        publishers: 1,
        subscribers: 3,
        endpoints: [
          {
            id: 'e1',
            node: '/lidar',
            role: 'publisher',
            type: 'sensor_msgs/msg/LaserScan',
            qos: { reliability: 'reliable' },
          },
          {
            id: 'e2',
            node: '/roboboy_inspector',
            role: 'subscriber',
            type: 'sensor_msgs/msg/LaserScan',
            observer: true,
            qos: { reliability: 'best_effort' },
          },
        ],
        compatibility: [{ publisher: '/lidar', subscriber: '/ui', level: 'error', reason: 'Reliability mismatch' }],
        schemas: {
          Message: [
            { name: 'ranges', type: 'float32[]' },
            { name: 'header', type: 'std_msgs/Header', fields: [{ name: 'frame_id', type: 'string' }] },
          ],
        },
        constants: { Message: [{ name: 'MAX_RANGE', value: 30 }] },
      }),
      topic('/speed', 'std_msgs/msg/Float64', {
        providers: ['/base', '/sim'],
        consumers: ['/ui'],
        publishers: 2,
        subscribers: 1,
      }),
      topic('/camera/image', 'sensor_msgs/msg/Image', { providers: ['/cam'], publishers: 1, subscribers: 0 }),
      topic('/rosout', 'rcl_interfaces/msg/Log', { publishers: 4, subscribers: 1 }),
      {
        id: 'service:/reset',
        kind: 'service',
        name: '/reset',
        types: ['std_srvs/srv/Trigger'],
        providers: ['/base'],
        consumers: ['/ui'],
        servers: 1,
        clients: 4,
        countKind: 'endpoints',
      },
      {
        id: 'action:/navigate',
        kind: 'action',
        name: '/navigate',
        types: ['nav2_msgs/action/NavigateToPose'],
        providers: ['/nav'],
        consumers: ['/ui'],
        servers: 1,
        clients: 1,
        countKind: 'nodes',
      },
      ...['/lidar', '/nav', '/ui', '/cam'].map(name => ({
        id: `node:${name}`,
        kind: 'node' as const,
        name,
        types: [],
        providers: [],
        consumers: [],
      })),
      { id: 'node:/base', kind: 'node', name: '/base', types: [], providers: [], consumers: [], instances: 2 },
    ],
    metrics: {
      '/speed': {
        rate: 20,
        bytesPerSec: 160,
        age: 0.05,
        count: 200,
        window: 10,
        source: 'host',
        intervalMean: 0.05,
        intervalMin: 0.04,
        intervalMax: 0.06,
        jitter: 0.001,
        meanBytes: 8,
        maxBytes: 8,
        observed: 30,
      },
      '/scan': {
        rate: null,
        bytesPerSec: null,
        age: null,
        count: 0,
        window: 0,
        source: 'host',
        unavailable: 'Not measured: the shared 32-topic probe budget is full',
      },
    },
    trends: {
      '/speed': [
        { time: NOW - 10_000, rate: 20, bytes: 160 },
        { time: NOW, rate: 21, bytes: 170 },
      ],
    },
    previews: {
      '/speed': { value: { data: 4 }, previous: { data: 3 }, receivedAt: NOW, truncated: false },
      '/navigate/_action/status': { value: { status_list: [] }, receivedAt: NOW, truncated: true },
    },
    diagnostics: [
      {
        id: 'd1',
        source: '/diagnostics',
        name: 'base/motor',
        hardware: 'm1',
        level: 1,
        message: 'Motor is hot',
        values: [{ key: 'temperature', value: '80' }],
        receivedAt: NOW,
      },
      {
        id: 'd2',
        source: '/diagnostics',
        name: 'base/battery',
        hardware: '',
        level: 0,
        message: 'OK',
        values: [],
        receivedAt: NOW - 60_000,
      },
    ],
    logs: [
      { id: 1, name: 'robot_monitor', level: 20, message: 'Cycle complete', receivedAt: NOW, repeats: 3 },
      { id: 2, name: 'robot_monitor', level: 40, message: 'Bumper pressed', receivedAt: NOW, repeats: 1 },
    ],
    events: [
      { id: 1, time: NOW, label: 'Topic /scan appeared', level: 0 },
      { id: 2, time: NOW, label: 'base/motor: Warning', level: 1 },
      { id: 3, time: NOW, label: 'base/motor: Error', level: 2 },
    ],
    goals: {
      '/navigate': [
        {
          id: 'abcdef0123456789',
          status: 2,
          firstSeen: NOW - 2000,
          changedAt: NOW - 1000,
          history: [
            { status: 1, time: NOW - 2000 },
            { status: 2, time: NOW - 1000 },
          ],
        },
      ],
    },
  };
}

const ros = {} as Ros;
const noReplay = { source: { ros: null } } as unknown as ReplaySession;
const onOpen = vi.fn<(request: ExplorerOpenRequest) => void>();
const saved = vi.fn<(value: RoboBoyJsonObject) => void>();
const lastConfig = () => (saved.mock.lastCall?.[0].config ?? {}) as Record<string, unknown>;

function Harness({
  config,
  replaySession = noReplay,
  connected = true,
}: {
  config?: Record<string, unknown>;
  replaySession?: ReplaySession;
  connected?: boolean;
}) {
  const [state, setState] = useState<RoboBoyJsonObject | undefined>(
    config ? ({ config } as unknown as RoboBoyJsonObject) : undefined
  );
  return (
    <DataExplorerPanel
      ros={connected ? ros : null}
      connected={connected}
      generation={1}
      isActive
      replaySession={replaySession}
      replayGeneration={0}
      state={state}
      onStateChange={value => {
        saved(value);
        setState(value);
      }}
      onOpen={onOpen}
    />
  );
}

const panel = () => screen.getByRole('region', { name: 'Data Explorer' });
const row = (name: string) => {
  const cell = within(panel()).getAllByText(name, { selector: 'strong' })[0];
  return cell.closest('.de-resource-row') as HTMLElement;
};
const names = () =>
  Array.from(panel().querySelectorAll('.de-resource-row .de-name-cell strong')).map(node => node.textContent);
const counts = (name: string) => Array.from(row(name).querySelectorAll('.de-count')).map(node => node.textContent);
const button = (name: string | RegExp) => within(panel()).getByRole('button', { name });

beforeEach(() => {
  fake.snapshot = liveSnapshot();
  fake.listeners.clear();
  const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  Element.prototype.scrollTo = vi.fn() as never;
  // jsdom has no PointerEvent; a MouseEvent carries the coordinates a column drag needs.
  if (!('PointerEvent' in window)) Object.assign(window, { PointerEvent: MouseEvent });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('Data Explorer resource list', () => {
  it('keeps one inspection lease while presented in XR and releases it when an inactive tile returns to desktop', () => {
    const release = vi.fn();
    fake.acquire.mockReturnValueOnce(release);
    const rendered = render(<DataExplorerPanel panelId="immersive" storageScope="cell" ros={ros} connected
      generation={1} isActive={false} replaySession={noReplay} replayGeneration={0}
      onStateChange={saved} onOpen={onOpen} />);
    expect(fake.acquire).not.toHaveBeenCalled();
    expect(getDataExplorerPresentation('immersive', 'other')).toBeNull();
    const present = getDataExplorerPresentation('immersive', 'cell')!;
    act(() => present(true));
    expect(fake.acquire).toHaveBeenCalledTimes(1);
    expect(panel()).toHaveAttribute('data-xr-presented', 'true');
    act(() => present(true));
    expect(fake.acquire).toHaveBeenCalledTimes(1);
    act(() => present(false));
    expect(release).toHaveBeenCalledOnce();
    expect(panel()).not.toHaveAttribute('data-xr-presented');
    rendered.unmount();
    expect(getDataExplorerPresentation('immersive', 'cell')).toBeNull();
  });
  it('lists topics with a column per count, measured rates and row actions', () => {
    render(<Harness />);
    expect(screen.getByText('ROS host')).toBeInTheDocument();
    expect(names()).toEqual(['/camera/image', '/scan', '/speed']);
    expect(counts('/speed')).toEqual(['2', '1']);
    expect(row('/speed').querySelector('.de-count')).toHaveAttribute('title', 'Endpoint count');
    expect(row('/speed').querySelector('.de-rate')).toHaveTextContent('20');
    expect(row('/scan').querySelector('.de-rate')).toHaveAttribute(
      'title',
      'Not measured: the shared 32-topic probe budget is full'
    );
    const heading = panel().querySelector('.de-table-heading')!;
    expect(heading).toHaveTextContent(/Pub.*Sub.*Hz.*Actions/);
    expect(within(row('/scan')).getByRole('button', { name: 'Open in 3D: /scan' })).toBeEnabled();
    expect(within(row('/camera/image')).getByRole('button', { name: 'Open in Camera: /camera/image' })).toBeEnabled();
    expect(within(row('/speed')).queryByRole('button', { name: /Open in/ })).not.toBeInTheDocument();
    expect(screen.getByText('Graph exceeds the discovery budget; this is a partial snapshot.')).toBeInTheDocument();
    expect(screen.getByText('1 inspection notice')).toBeInTheDocument();
    expect(fake.acquire).toHaveBeenCalled();
  });

  it('shows hidden resources, watched topics only, and resources with missing endpoints', () => {
    render(<Harness config={{ watched: ['/speed'] }} />);
    fireEvent.click(button('Show hidden and infrastructure resources'));
    expect(names()).toContain('/rosout');
    fireEvent.click(button('Show hidden and infrastructure resources'));
    expect(names()).not.toContain('/rosout');

    fireEvent.click(button('Show watched topics only'));
    expect(names()).toEqual(['/speed']);
    // Only topics can be watched, so the filter leaves other kinds alone.
    fireEvent.click(button(/^Services/));
    expect(names()).toEqual(['/reset']);
    expect(within(panel()).queryByRole('button', { name: 'Show watched topics only' })).not.toBeInTheDocument();
    fireEvent.click(button(/^Topics/));
    fireEvent.click(button('Show watched topics only'));

    fireEvent.click(button('Show resources with missing endpoints'));
    expect(names()).toEqual(['/camera/image']);
    fireEvent.change(within(panel()).getByRole('searchbox', { name: 'Search resources' }), {
      target: { value: 'nothing' },
    });
    expect(screen.getByText('No resources match this view.')).toBeInTheDocument();
  });

  it('sorts by clicking headings and resizes columns by keyboard and by dragging', () => {
    render(<Harness />);
    fireEvent.click(button('Sort by Publishers'));
    expect(names()).toEqual(['/speed', '/camera/image', '/scan']);
    expect(panel().querySelector('.de-heading-cell.is-sorted')).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(button('Sort by Publishers'));
    expect(lastConfig()).toMatchObject({ sort: 'providers', sortDir: 'asc' });
    fireEvent.click(button('Sort by Subscribers'));
    expect(names()).toEqual(['/scan', '/speed', '/camera/image']);
    fireEvent.click(button('Sort by Observed rate of watched topics'));
    expect(names()[0]).toBe('/speed');
    fireEvent.click(button('Sort by Name'));
    expect(names()).toEqual(['/camera/image', '/scan', '/speed']);

    const handle = within(panel()).getByRole('separator', { name: 'Resize Pub column' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(lastConfig().columns).toMatchObject({ providers: 64 });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    expect(lastConfig().columns).toMatchObject({ providers: 44 });
    fireEvent.keyDown(handle, { key: 'Enter' });

    const rate = within(panel()).getByRole('separator', { name: 'Resize Hz column' });
    fireEvent.pointerDown(rate, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(rate, { clientX: 150, pointerId: 1 });
    fireEvent.pointerUp(rate, { pointerId: 1 });
    expect(lastConfig().columns).toMatchObject({ rate: 126 });
  });

  it('acts on several checked topics at once', async () => {
    render(<Harness />);
    fireEvent.click(within(row('/scan')).getByRole('checkbox', { name: 'Select /scan' }));
    fireEvent.click(within(row('/speed')).getByRole('checkbox', { name: 'Select /speed' }));
    const bar = within(panel()).getByRole('toolbar', { name: 'Selected resources' });
    expect(bar).toHaveTextContent('2 selected');

    fireEvent.click(within(bar).getByRole('button', { name: 'Watch traffic of the selected topics' }));
    expect(lastConfig().watched).toEqual(['/scan', '/speed']);
    fireEvent.click(within(bar).getByRole('button', { name: 'Stop watching the selected topics' }));
    expect(lastConfig().watched).toEqual([]);

    fireEvent.click(within(bar).getByRole('button', { name: 'Add a health rule to each selected topic' }));
    expect(lastConfig().rules).toEqual([
      { topic: '/scan', silenceSec: 5 },
      { topic: '/speed', silenceSec: 5 },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('2 health rules added');

    fireEvent.click(within(bar).getByRole('button', { name: 'Pin the selected resources' }));
    expect(lastConfig().pinned).toEqual(['topic:/scan', 'topic:/speed']);
    expect(names().slice(0, 2)).toEqual(['/scan', '/speed']);
    fireEvent.click(within(bar).getByRole('button', { name: 'Unpin the selected resources' }));
    expect(lastConfig().pinned).toEqual([]);

    fireEvent.click(within(bar).getByRole('button', { name: 'Copy the selected names' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/scan\n/speed');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));

    fireEvent.click(within(bar).getByRole('button', { name: 'Open recording settings with the selected topics' }));
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ panel: 'recordReplay', topic: '/scan', topics: ['/scan', '/speed'] })
    );

    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(within(panel()).queryByRole('toolbar', { name: 'Selected resources' })).not.toBeInTheDocument();

    // The heading checkbox selects everything shown; shift-click selects a range.
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Select all shown' }));
    expect(within(panel()).getByRole('toolbar')).toHaveTextContent('3 selected');
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Clear selection' }));
    fireEvent.click(within(row('/camera/image')).getByRole('checkbox'));
    fireEvent.click(within(row('/speed')).getByRole('checkbox'), { shiftKey: true });
    expect(within(panel()).getByRole('toolbar')).toHaveTextContent('3 selected');
  });

  it('keeps the watch limit and the rule limit', () => {
    const many = Array.from({ length: 32 }, (_, index) => `/t${index}`);
    render(<Harness config={{ watched: many, rules: many.map(name => ({ topic: name })) }} />);
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Watch traffic of /speed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Watch limit reached');
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Add health rule for /speed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Rule limit reached');
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Select all shown' }));
    fireEvent.click(button('Watch traffic of the selected topics'));
    expect(screen.getByRole('status')).toHaveTextContent('Watch limit is 32 topics');
    fireEvent.click(button('Add a health rule to each selected topic'));
    expect(screen.getByRole('status')).toHaveTextContent('the 32-rule limit was reached');
  });

  it('runs row actions and opens an existing rule in Health', () => {
    render(<Harness />);
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Watch traffic of /speed' }));
    expect(lastConfig().watched).toEqual(['/speed']);
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Stop watching /speed' }));
    expect(lastConfig().watched).toEqual([]);
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Record /speed' }));
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ panel: 'recordReplay', topic: '/speed' }));
    fireEvent.click(within(row('/scan')).getByRole('button', { name: 'Open in 3D: /scan' }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ panel: '3d', topic: '/scan', visualizationType: 'laserscan' })
    );
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Add health rule for /speed' }));
    expect(lastConfig().rules).toEqual([{ topic: '/speed', silenceSec: 5 }]);
    fireEvent.click(within(row('/speed')).getByRole('button', { name: 'Show health rule for /speed' }));
    expect(button('Rules')).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel()).getByRole('searchbox')).toHaveAttribute('placeholder', 'Search diagnostics…');
  });

  it('refreshes discovery and exports everything the panel knows', () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<Harness />);
    fireEvent.click(button('Refresh resources'));
    expect(fake.refresh).toHaveBeenCalled();
    fireEvent.click(button('Export inspection snapshot'));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('follows snapshot updates from the shared session', () => {
    render(<Harness />);
    act(() => {
      fake.snapshot = { ...fake.snapshot, loading: true, resources: [] };
      fake.listeners.forEach(listener => listener());
    });
    expect(screen.getByText('Discovering ROS resources…')).toBeInTheDocument();
  });
});

describe('Data Explorer inspector', () => {
  it('previews a topic value with freeze, field search, copy and plot', async () => {
    render(<Harness />);
    fireEvent.click(within(row('/speed')).getByText('/speed'));
    const inspector = within(screen.getByRole('complementary', { name: '/speed inspector' }));
    expect(inspector.getByText('data')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Freeze message' }));
    expect(inspector.getByRole('button', { name: 'Resume message' })).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Resume message' }));
    fireEvent.change(inspector.getByRole('searchbox', { name: 'Find a field' }), { target: { value: 'dat' } });
    fireEvent.click(inspector.getByRole('button', { name: /Copy preview/ }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify({ data: 4 }, null, 2));
    fireEvent.click(inspector.getByRole('button', { name: 'Plot data' }));
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ panel: 'timeSeries', topic: '/speed', fieldPath: 'data' })
    );
    fireEvent.click(inspector.getByRole('button', { name: 'Pin /speed' }));
    expect(lastConfig().pinned).toEqual(['topic:/speed']);
    fireEvent.click(inspector.getByRole('button', { name: 'Unpin /speed' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Copy resource name' }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('/speed');
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('shows endpoints with observers and QoS problems, traffic and the schema', () => {
    render(<Harness config={{ watched: ['/speed'] }} />);
    fireEvent.click(within(row('/scan')).getByText('/scan'));
    let inspector = within(screen.getByRole('complementary', { name: '/scan inspector' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Endpoints' }));
    expect(inspector.getByText('Publisher nodes')).toBeInTheDocument();
    expect(inspector.getByText('Observer')).toBeInTheDocument();
    expect(inspector.getByText('/lidar → /ui: Reliability mismatch')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Traffic' }));
    expect(inspector.getByText('Not measured: the shared 32-topic probe budget is full')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Schema' }));
    expect(inspector.getByText('ranges')).toBeInTheDocument();
    expect(inspector.getByText('frame_id')).toBeInTheDocument();
    expect(inspector.getByText('Constants · 1')).toBeInTheDocument();

    fireEvent.click(inspector.getByRole('button', { name: 'Back to resources' }));
    fireEvent.click(within(row('/speed')).getByText('/speed'));
    inspector = within(screen.getByRole('complementary', { name: '/speed inspector' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Traffic' }));
    expect(inspector.getByText('20 Hz')).toBeInTheDocument();
    expect(inspector.getByRole('img', { name: 'Observed frequency history: now 21 Hz' })).toBeInTheDocument();
    expect(inspector.getByText('Mean interval')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Schema' }));
    expect(inspector.getByText('Loading interface fields from the ROS host…')).toBeInTheDocument();

    // An unwatched topic offers to watch it instead of showing empty measurements.
    fireEvent.click(inspector.getByRole('button', { name: 'Back to resources' }));
    fireEvent.click(within(row('/camera/image')).getByText('/camera/image'));
    inspector = within(screen.getByRole('complementary', { name: '/camera/image inspector' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Traffic' }));
    fireEvent.click(inspector.getByRole('button', { name: 'Watch this topic' }));
    expect(lastConfig().watched).toEqual(['/speed', '/camera/image']);
    fireEvent.click(inspector.getByRole('button', { name: 'Value' }));
    expect(inspector.getByText('Waiting for a message…')).toBeInTheDocument();
  });

  it('inspects services, actions and nodes with the columns that fit them', () => {
    render(<Harness />);
    fireEvent.click(button(/^Services/));
    expect(panel().querySelector('.de-table-heading')).toHaveTextContent(/Srv.*Cli/);
    expect(panel().querySelector('.de-table-heading')).not.toHaveTextContent('Hz');
    expect(counts('/reset')).toEqual(['1', '4']);
    fireEvent.click(within(row('/reset')).getByText('/reset'));
    let inspector = within(screen.getByRole('complementary', { name: '/reset inspector' }));
    expect(inspector.getByText('Server nodes')).toBeInTheDocument();
    expect(inspector.getByText(/Discovery shows presence, not responsiveness/)).toBeInTheDocument();

    fireEvent.click(button(/^Actions/));
    expect(row('/navigate').querySelector('.de-count')).toHaveAttribute('title', 'Participating node count');
    fireEvent.click(within(row('/navigate')).getByText('/navigate'));
    inspector = within(screen.getByRole('complementary', { name: '/navigate inspector' }));
    expect(inspector.getByText('Executing')).toBeInTheDocument();
    expect(inspector.getByText('abcdef01')).toBeInTheDocument();
    expect(inspector.getByText(/Accepted → Executing/)).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Feedback' }));
    expect(inspector.getByText('Waiting for a message…')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Endpoints' }));
    expect(inspector.getByText('Action transport')).toBeInTheDocument();
    expect(inspector.getByText('Counts are participating nodes')).toBeInTheDocument();

    fireEvent.click(button(/^Nodes/));
    expect(counts('/base')).toEqual(['1', '0']);
    expect(counts('/lidar')).toEqual(['1', '0']);
    fireEvent.click(within(row('/base')).getByText('/base'));
    inspector = within(screen.getByRole('complementary', { name: '/base inspector' }));
    expect(inspector.getByText('2 nodes share this name. Membership may be ambiguous.')).toBeInTheDocument();
    fireEvent.click(button(/^Nodes/));
    fireEvent.click(within(row('/lidar')).getByText('/lidar'));
    inspector = within(screen.getByRole('complementary', { name: '/lidar inspector' }));
    fireEvent.click(inspector.getByRole('button', { name: /\/scan/ }));
    expect(screen.getByRole('complementary', { name: '/scan inspector' })).toBeInTheDocument();
  });
});

describe('Data Explorer health view', () => {
  it('shows diagnostics, logs and events', () => {
    render(<Harness />);
    fireEvent.click(button('Health'));
    expect(panel()).toHaveTextContent('2 components');
    expect(panel()).toHaveTextContent('2 need attention');
    expect(screen.getByText('Update stale')).toBeInTheDocument();
    expect(screen.getByText('Motor is hot')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('/diagnostics'), { target: { value: '/diagnostics_agg' } });
    expect(lastConfig().diagnosticTopic).toBe('/diagnostics_agg');
    expect(screen.getByText(/Waiting for diagnostics from \/diagnostics_agg/)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '0' } });
    expect(lastConfig().staleSec).toBe(1);

    fireEvent.click(button('Logs'));
    expect(screen.getByText('×3')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Minimum log severity' }), { target: { value: '40' } });
    expect(screen.queryByText('Cycle complete')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter logs' }), { target: { value: 'bumper' } });
    expect(screen.getByText('Bumper pressed')).toBeInTheDocument();
    fireEvent.click(button('Freeze logs'));
    fireEvent.click(button('Resume logs'));

    fireEvent.click(button('Events'));
    expect(screen.getByText('Topic /scan appeared')).toBeInTheDocument();
    expect(screen.getByText('Warn')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('edits and removes topic rules and jumps to their topic', () => {
    render(<Harness config={{ view: 'health', rules: [{ topic: '/speed', minHz: 30 }, { topic: '/scan' }] }} />);
    fireEvent.click(button('Rules'));
    expect(screen.getByText('No measured rule violations')).toBeInTheDocument();
    expect(screen.getByText('Not measured: the shared 32-topic probe budget is full')).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Minimum Hz' })[0], { target: { value: '10' } });
    expect(lastConfig().rules).toEqual([{ topic: '/speed', minHz: 10 }, { topic: '/scan' }]);
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Minimum Hz' })[0], { target: { value: '' } });
    expect(lastConfig().rules).toEqual([{ topic: '/speed' }, { topic: '/scan' }]);
    fireEvent.click(button('Remove rule /scan'));
    expect(lastConfig().rules).toEqual([{ topic: '/speed' }]);
    fireEvent.click(button('/speed'));
    expect(lastConfig()).toMatchObject({ view: 'resources', kind: 'topic', selected: 'topic:/speed' });
  });

  it('reports a rule once it has been violated for the grace period', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    render(<Harness config={{ view: 'health', rules: [{ topic: '/speed', minHz: 30 }] }} />);
    fireEvent.click(button('Rules'));
    act(() => {
      fake.snapshot = { ...fake.snapshot, now: NOW + 5000, updatedAt: NOW + 5000 };
      fake.listeners.forEach(listener => listener());
    });
    expect(screen.getByText('Rate 20 Hz; expected ≥ 30')).toBeInTheDocument();
    expect(fake.recordEvent).toHaveBeenCalledWith('Rule /speed: Rate 20 Hz; expected ≥ 30', 1);
    expect(panel()).toHaveTextContent('1 violated');
  });
});

describe('Data Explorer graph view', () => {
  it('draws the selected layer, focuses on a click and saves dragged positions', async () => {
    render(<Harness config={{ view: 'graph', watched: ['/speed'] }} />);
    expect(screen.getByTestId('flow')).toBeInTheDocument();
    expect(panel()).toHaveTextContent(/nodes · \d+ links/);
    await waitFor(() => expect(fake.fitView).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText('Drag topic:/speed'));
    expect(lastConfig().positions).toEqual({ 'topic|topic:/speed': { x: 5, y: 7 } });
    fireEvent.click(within(screen.getByTestId('flow')).getAllByRole('button', { name: /\/speed/ })[0]);
    expect(lastConfig().selected).toBe('topic:/speed');
    fireEvent.click(button('Clear focus'));
    expect(lastConfig().selected).toBe('');
    fireEvent.click(button(/^Services/));
    expect(screen.getByTestId('edges').textContent).toContain('/reset');
  });
});

describe('Data Explorer on narrow tiles', () => {
  it('folds filters into a menu and closes the inspector when switching views', () => {
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 360, height: 400 } } as ResizeObserverEntry], this as never);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      render(<Harness />);
      expect(panel()).toHaveAttribute('data-short', 'true');
      expect(within(panel()).getByRole('searchbox', { name: 'Search resources' })).toHaveAttribute(
        'placeholder',
        'Search…'
      );
      fireEvent.click(button('Filters'));
      const menu = within(within(panel()).getByRole('group', { name: 'Filters' }));
      fireEvent.click(menu.getByRole('checkbox', { name: 'Show hidden and infrastructure resources' }));
      expect(names()).toContain('/rosout');
      expect(button('Filters')).toHaveAttribute('data-active', 'true');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(within(panel()).queryByRole('group', { name: 'Filters' })).not.toBeInTheDocument();
      fireEvent.click(button('Filters'));
      fireEvent.pointerDown(document.body);
      expect(within(panel()).queryByRole('group', { name: 'Filters' })).not.toBeInTheDocument();

      fireEvent.change(within(panel()).getByRole('combobox', { name: 'Resource type' }), {
        target: { value: 'service' },
      });
      expect(names()).toEqual(['/reset']);
      fireEvent.click(within(row('/reset')).getByText('/reset'));
      expect(panel()).toHaveAttribute('data-selected', 'true');
      fireEvent.click(button('Graph'));
      expect(lastConfig()).toMatchObject({ view: 'graph', selected: '' });
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });
});

describe('Data Explorer sources', () => {
  const recording = {
    source: { ros: {} as Ros },
    snapshot: {
      info: { name: 'walk.mcap', start: 0n, end: 10_000_000_000n },
      position: 0,
    },
  } as unknown as ReplaySession;

  it('inspects a recording with recorded counts, averages and definitions', () => {
    fake.snapshot = {
      ...emptySnapshot(),
      mode: 'recorded',
      online: false,
      loading: false,
      resources: [
        topic('/scan', 'sensor_msgs/msg/LaserScan', {
          recordedCount: 100,
          countKind: undefined,
          definition: 'float32[] ranges',
        }),
        topic('/speed', 'std_msgs/msg/Float64', { recordedCount: 50, countKind: undefined }),
      ],
    };
    render(<Harness replaySession={recording} />);
    expect(screen.getByText('Recording')).toBeInTheDocument();
    expect(screen.getByText('walk.mcap')).toBeInTheDocument();
    expect(panel().querySelector('.de-table-heading')).toHaveTextContent(/Msgs.*Avg Hz/);
    expect(row('/scan').querySelector('.de-count')).toHaveTextContent('100');
    expect(row('/scan').querySelector('.de-rate')).toHaveTextContent('10');
    // A recording has no watch probes and no endpoint counts.
    expect(within(panel()).queryByRole('button', { name: 'Show watched topics only' })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole('button', { name: 'Show resources with missing endpoints' })).toBeNull();
    fireEvent.click(within(row('/scan')).getByText('/scan'));
    const inspector = within(screen.getByRole('complementary', { name: '/scan inspector' }));
    expect(inspector.getByText('Topology not recorded')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Traffic' }));
    expect(inspector.getByText(/100 messages in this recording/)).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Schema' }));
    expect(inspector.getByText('Recorded definition')).toBeInTheDocument();
    fireEvent.click(inspector.getByRole('button', { name: 'Endpoints' }));
    expect(inspector.getAllByText('Not recorded')).toHaveLength(2);
    fireEvent.click(button('Graph'));
    expect(screen.getByText(/topology was not recorded/)).toBeInTheDocument();
    fireEvent.click(button(/^Services/));
    fireEvent.click(button('Resources'));
    expect(screen.getByText('Not recorded in this MCAP.')).toBeInTheDocument();
    fireEvent.change(within(panel()).getByRole('combobox', { name: 'Inspection source' }), {
      target: { value: 'live' },
    });
    expect(lastConfig().source).toBe('live');
  });

  it('keeps visualizations on the recording while the live robot is inspected', () => {
    render(<Harness config={{ source: 'live' }} replaySession={recording} />);
    expect(screen.getByText('Live robot · visualizations follow the recording')).toBeInTheDocument();
    expect(within(row('/scan')).getByRole('button', { name: 'Open in 3D: /scan' })).toBeDisabled();
    fireEvent.click(within(row('/speed')).getByText('/speed'));
    expect(within(panel()).queryByRole('button', { name: 'Plot data' })).not.toBeInTheDocument();
  });

  it('labels browser-only inspection and a missing connection', () => {
    fake.snapshot = {
      ...liveSnapshot(),
      mode: 'browser',
      online: false,
      metrics: {
        '/speed': { rate: 9.5, bytesPerSec: 80, age: 0.1, count: 10, window: 1, source: 'browser', ceiling: 10 },
      },
    };
    const { unmount } = render(<Harness />);
    expect(screen.getByText('Companion unavailable · limited inspection')).toBeInTheDocument();
    expect(row('/speed').querySelector('.de-rate')).toHaveTextContent('≥ 10');
    expect(screen.getByText('Preview rates ≠ publisher rates')).toBeInTheDocument();
    fireEvent.click(within(row('/speed')).getByText('/speed'));
    fireEvent.click(button('Traffic'));
    expect(screen.getByText(/Received in the browser/)).toBeInTheDocument();
    fireEvent.click(button('Schema'));
    expect(screen.getByText('Interface schemas require the ROS inspection companion.')).toBeInTheDocument();
    fireEvent.click(button('Back to resources'));
    fireEvent.click(within(row('/camera/image')).getByText('/camera/image'));
    fireEvent.click(button('Endpoints'));
    expect(screen.getByText('Details require the ROS inspection companion')).toBeInTheDocument();
    unmount();

    render(<Harness connected={false} />);
    expect(screen.getByText('Connect to ROS or open a recording')).toBeInTheDocument();
    expect(button('Refresh resources')).toBeDisabled();
  });
});
