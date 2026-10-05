import { describe, expect, it } from 'vitest';
import {
  applyExplorerSettings,
  describeDataExplorer,
  findResource,
  queryLogs,
  type ExplorerBridgeInput,
} from './assistantBridge';
import { emptySnapshot } from './InspectionSession';
import { sanitizeExplorerConfig } from './model';
import type { InspectionSnapshot, Resource } from './types';

const NOW = 1_700_000_000_000;
const topic = (name: string, patch: Partial<Resource> = {}): Resource => ({
  id: `topic:${name}`,
  kind: 'topic',
  name,
  types: ['std_msgs/msg/Float64'],
  providers: [],
  consumers: [],
  countKind: 'endpoints',
  ...patch,
});

const snapshot = (patch: Partial<InspectionSnapshot> = {}): InspectionSnapshot => ({
  ...emptySnapshot(),
  mode: 'host',
  online: true,
  current: true,
  now: NOW,
  updatedAt: Date.now(),
  resources: [
    topic('/speed', { providers: ['/base'], consumers: ['/ui'], publishers: 1, subscribers: 1 }),
    topic('/scan', {
      types: ['sensor_msgs/msg/LaserScan'],
      providers: ['/lidar'],
      publishers: 1,
      subscribers: 0,
      compatibility: [{ publisher: '/lidar', subscriber: '/ui', level: 'error', reason: 'Reliability mismatch' }],
      endpoints: [
        {
          id: 'e',
          node: '/lidar',
          role: 'publisher',
          type: 'sensor_msgs/msg/LaserScan',
          qos: { reliability: 'reliable' },
        },
      ],
      schemas: { Message: [{ name: 'ranges', type: 'float32[]' }] },
    }),
    topic('/rosout', { types: ['rcl_interfaces/msg/Log'] }),
    {
      id: 'service:/reset',
      kind: 'service',
      name: '/reset',
      types: ['std_srvs/srv/Trigger'],
      providers: ['/base'],
      consumers: [],
      servers: 1,
      clients: 0,
      countKind: 'nodes',
    },
    {
      id: 'action:/dock',
      kind: 'action',
      name: '/dock',
      types: ['nav2_msgs/action/Dock'],
      providers: ['/nav'],
      consumers: ['/ui'],
      servers: 1,
      clients: 1,
    },
    { id: 'node:/base', kind: 'node', name: '/base', types: [], providers: [], consumers: [], instances: 2 },
    {
      id: 'node:/rosbridge_websocket',
      kind: 'node',
      name: '/rosbridge_websocket',
      types: [],
      providers: [],
      consumers: [],
    },
  ],
  metrics: {
    '/speed': { rate: 9.6, bytesPerSec: 80, age: 0.1, count: 96, window: 10, source: 'browser', ceiling: 10 },
    '/scan': {
      rate: null,
      bytesPerSec: null,
      age: null,
      count: 0,
      window: 0,
      source: 'host',
      unavailable: 'Probe limit reached',
    },
  },
  previews: { '/speed': { value: { data: 4 }, receivedAt: NOW - 500, truncated: false } },
  diagnostics: [
    {
      id: 'a',
      source: '/diagnostics',
      name: 'battery',
      hardware: '',
      level: 0,
      message: 'OK',
      values: [],
      receivedAt: NOW,
    },
    {
      id: 'b',
      source: '/diagnostics',
      name: 'motor',
      hardware: 'm1',
      level: 2,
      message: 'Overheated',
      values: [{ key: 'temp', value: '90' }],
      receivedAt: NOW,
    },
    {
      id: 'c',
      source: '/diagnostics_agg',
      name: 'other',
      hardware: '',
      level: 1,
      message: 'x',
      values: [],
      receivedAt: NOW,
    },
  ],
  logs: [
    { id: 1, name: 'planner', level: 20, message: 'Planning', receivedAt: NOW - 3000, repeats: 1 },
    { id: 2, name: 'planner', level: 40, message: 'No path found', receivedAt: NOW - 2000, repeats: 3 },
    { id: 3, name: 'driver', level: 30, message: 'Low battery', receivedAt: NOW - 1000, repeats: 1 },
  ],
  events: [{ id: 1, time: NOW, label: 'Topic /scan appeared', level: 0 }],
  ...patch,
});

const input = (patch: Partial<ExplorerBridgeInput> = {}): ExplorerBridgeInput => ({
  snapshot: snapshot(),
  config: sanitizeExplorerConfig({ watched: ['/speed'] }),
  ruleStates: new Map(),
  active: true,
  connected: true,
  ...patch,
});

describe('Data Explorer as the assistant sees it', () => {
  it('lists resources with their counts and measurements, followed topics first and infrastructure hidden', () => {
    const view = describeDataExplorer(input());
    expect(view.source).toContain('inspection companion');
    expect(view.topics.map(item => item.name)).toEqual(['/speed', '/scan']);
    expect(view.topics[0]).toMatchObject({
      publishers: 1,
      subscribers: 1,
      watched: true,
      hz: 9.6,
      hzIsLowerBound: true,
    });
    expect(view.topics[1]).toMatchObject({ notMeasured: 'Probe limit reached', qosIncompatible: true });
    expect(view.services).toEqual([
      { name: '/reset', type: 'std_srvs/srv/Trigger', servers: 1, clients: 0, countKind: 'nodes' },
    ]);
    expect(view.actions[0]).toMatchObject({ name: '/dock', servers: 1, clients: 1 });
    expect(view.nodes).toEqual([{ name: '/base', publishesTopics: 1, subscribesTopics: 0, sharedName: 2 }]);
    expect(view.notListed.hidden).toBe(2);
    const shown = describeDataExplorer(input({ config: sanitizeExplorerConfig({ showHidden: true }) }));
    expect(shown.topics.map(item => item.name)).toContain('/rosout');
  });

  it('puts diagnostics that need attention first, and summarises logs, events and rules', () => {
    const view = describeDataExplorer(
      input({
        config: sanitizeExplorerConfig({ rules: [{ topic: '/speed', minHz: 20 }, { topic: '/missing' }] }),
        ruleStates: new Map([['/speed', { issues: ['Rate 9.6 Hz; expected ≥ 20'], since: NOW - 4000 }]]),
      })
    );
    expect(view.diagnostics).toMatchObject({ topic: '/diagnostics', components: 2, needAttention: 1 });
    expect(view.diagnostics.items.map(item => item.name)).toEqual(['motor', 'battery']);
    expect(view.diagnostics.items[0]).toMatchObject({ level: 'error', values: [{ key: 'temp', value: '90' }] });
    expect(view.logs).toMatchObject({ kept: 3, warnings: 1, errors: 1 });
    expect(view.logs.latest[1]).toMatchObject({ node: 'planner', level: 'error', repeats: 3, secondsAgo: 2 });
    expect(view.logs.matching).toBeUndefined();
    expect(view.events[0].label).toBe('Topic /scan appeared');
    expect(view.rules[0]).toMatchObject({ topic: '/speed', state: 'violated', sinceSecondsAgo: 4 });
    expect(view.rules[1]).toMatchObject({ topic: '/missing', state: 'not measured yet' });
  });

  it('details the selected resource with its latest message, endpoints and schema', () => {
    const speed = describeDataExplorer(input({ config: sanitizeExplorerConfig({ selected: 'topic:/speed' }) }));
    expect(speed.selected).toBe('topic:/speed');
    expect(speed.selectedResource).toMatchObject({ latestMessage: { receivedSecondsAgo: 0.5, value: { data: 4 } } });
    const scan = describeDataExplorer(input({ config: sanitizeExplorerConfig({ selected: 'topic:/scan' }) }));
    expect(scan.selectedResource).toMatchObject({
      endpoints: [{ node: '/lidar', role: 'publisher', qos: { reliability: 'reliable' } }],
      schema: { Message: [{ name: 'ranges', type: 'float32[]' }] },
      latestMessage: 'No message received yet.',
    });
    const node = describeDataExplorer(input({ config: sanitizeExplorerConfig({ selected: 'node:/base' }) }));
    expect(node.selectedResource?.relatedResources).toEqual([
      'topic /speed (provides/publishes)',
      'service /reset (provides/publishes)',
    ]);
  });

  it('labels recordings, a missing companion, a missing connection and a hidden panel', () => {
    const recorded = describeDataExplorer(
      input({
        snapshot: snapshot({ mode: 'recorded', online: false, resources: [topic('/speed', { recordedCount: 100 })] }),
        recording: { name: 'run.mcap', seconds: 10 },
      })
    );
    expect(recorded.source).toContain('run.mcap');
    expect(recorded.topics[0]).toMatchObject({ recordedMessages: 100, averageHz: 10 });
    expect(describeDataExplorer(input({ snapshot: snapshot({ online: false }) })).source).toContain('browser only');
    expect(describeDataExplorer(input({ connected: false })).source).toBe('not connected to ROS');
    expect(describeDataExplorer(input({ active: false })).paused).toContain('hidden');
  });

  it('answers a log query from every kept entry', () => {
    const view = describeDataExplorer(input({ logQuery: { level: 30, limit: 200 } }));
    expect(view.logs.matching).toMatchObject({ filter: { level: 'warning' }, found: 2 });
    expect(queryLogs(snapshot(), { node: 'PLAN', text: 'path', limit: 5 }).entries).toEqual([
      expect.objectContaining({ message: 'No path found' }),
    ]);
    expect(queryLogs(snapshot(), { limit: 1 }).entries.map(entry => entry.message)).toEqual(['Low battery']);
  });
});

describe('Data Explorer settings from the assistant', () => {
  const config = sanitizeExplorerConfig({ watched: ['/speed'], rules: [{ topic: '/speed', minHz: 5 }] });
  const apply = (settings: Record<string, unknown>, recording = false, base = config) =>
    applyExplorerSettings(base, settings, snapshot(), { recording });

  it('watches and unwatches topics on the graph, within the limit', () => {
    const watched = apply({ watch: ['/scan', '/nowhere'] });
    expect(watched.patch.watched).toEqual(['/speed', '/scan']);
    expect(watched.outcomes).toEqual([
      { ok: true, message: 'Watching /scan.' },
      { ok: false, message: 'No topic named /nowhere is on the graph.' },
    ]);
    expect(apply({ watch: '/speed' }).outcomes[0]).toEqual({ ok: true, message: '/speed already watched.' });
    expect(apply({ unwatch: 'all' }).patch.watched).toEqual([]);
    expect(apply({ unwatch: ['/scan'] }).outcomes[0].ok).toBe(false);

    const full = sanitizeExplorerConfig({ watched: Array.from({ length: 32 }, (_, index) => `/t${index}`) });
    expect(apply({ watch: ['/scan'] }, false, full).outcomes[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining('limit is 32'),
    });
    expect(apply({ watch: ['/scan'] }, true).outcomes[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining('recording'),
    });
  });

  it('trusts well-formed names while a newly opened panel is still discovering the graph', () => {
    const discovering = { ...emptySnapshot(), loading: true };
    const result = applyExplorerSettings(config, { watch: ['/scan', 'scan'], select: 'service:/reset' }, discovering, {
      recording: false,
    });
    expect(result.patch).toMatchObject({ watched: ['/speed', '/scan'], selected: 'service:/reset', kind: 'service' });
    expect(result.outcomes[0].message).toContain('still being discovered');
    expect(result.outcomes[1]).toEqual({ ok: false, message: 'No topic named scan is on the graph.' });
    expect(applyExplorerSettings(config, { select: '/odom' }, discovering, { recording: false }).patch.selected).toBe(
      'topic:/odom'
    );
  });

  it('adds, updates and removes health rules', () => {
    const added = apply({ addRules: [{ topic: '/scan', minHz: 9 }, { topic: '/later' }] });
    expect(added.patch.rules).toEqual([
      { topic: '/speed', minHz: 5 },
      { topic: '/scan', minHz: 9 },
      { topic: '/later', silenceSec: 5 },
    ]);
    expect(added.outcomes[1].message).toContain('not on the graph yet');
    const updated = apply({ rules: { topic: '/speed', maxHz: 20, minHz: null } });
    expect(updated.patch.rules).toEqual([{ topic: '/speed', maxHz: 20 }]);
    expect(apply({ addRules: [{ topic: '/speed', minHz: 30, maxHz: 10 }] }).outcomes[0].ok).toBe(false);
    expect(apply({ addRules: [{ topic: 'speed' }] }).outcomes[0].ok).toBe(false);
    expect(apply({ removeRules: '/speed' }).patch.rules).toEqual([]);
    expect(apply({ removeRules: 'all' }).patch.rules).toEqual([]);
    expect(apply({ removeRules: ['/none'] }).outcomes[0].ok).toBe(false);
    const full = sanitizeExplorerConfig({ rules: Array.from({ length: 32 }, (_, index) => ({ topic: `/t${index}` })) });
    expect(apply({ addRules: [{ topic: '/scan' }] }, false, full).outcomes[0].message).toContain('limit is 32');
  });

  it('selects resources and changes the view', () => {
    expect(apply({ select: '/reset' }).patch).toMatchObject({ selected: 'service:/reset', kind: 'service' });
    expect(apply({ select: 'node:/base' }).patch.selected).toBe('node:/base');
    expect(apply({ select: '/nothing' }).outcomes[0].ok).toBe(false);
    expect(apply({ select: '' }).patch.selected).toBe('');
    expect(apply({ select: '/scan' }, false, sanitizeExplorerConfig({ view: 'health' })).patch.view).toBe('resources');
    const changed = apply({
      view: 'graph',
      kind: 'action',
      query: 'dock',
      showHidden: true,
      diagnosticTopic: '/diagnostics_agg',
      staleSec: 99999,
      source: 'live',
      refresh: true,
      pin: ['/speed'],
    });
    expect(changed.patch).toMatchObject({
      view: 'graph',
      kind: 'action',
      selected: '',
      query: 'dock',
      showHidden: true,
      diagnosticTopic: '/diagnostics_agg',
      staleSec: 3600,
      source: 'live',
      pinned: ['topic:/speed'],
    });
    expect(changed.refresh).toBe(true);
    expect(
      apply({ unpin: '/speed' }, false, sanitizeExplorerConfig({ pinned: ['topic:/speed'] })).patch.pinned
    ).toEqual([]);
    expect(apply({ diagnosticTopic: 'diag' }).outcomes[0].ok).toBe(false);
    expect(apply({ refresh: true }, true).refresh).toBe(false);
  });

  it('keeps a log query for the next turn', () => {
    const result = apply({ logs: { level: 'error', node: 'planner', limit: 9999 } });
    expect(result.logQuery).toEqual({ level: 40, node: 'planner', limit: 200 });
    expect(result.outcomes[0]).toEqual({ ok: true, message: '1 of the 3 kept /rosout entries match.' });
    expect(apply({ logs: true }).logQuery).toEqual({ limit: 200 });
    expect(apply({ logs: { level: 'loud' } }).outcomes[1].ok).toBe(false);
  });

  it('says what it did not understand', () => {
    expect(apply({ colour: 'red' }).outcomes).toEqual([
      { ok: false, message: 'The Data Explorer has no setting "colour".' },
    ]);
    expect(apply({}).outcomes[0].message).toContain('Nothing in those settings applies');
  });

  it('finds resources by name or kind-qualified name, preferring topics', () => {
    const shared = snapshot({
      resources: [{ id: 'node:/x', kind: 'node', name: '/x', types: [], providers: [], consumers: [] }, topic('/x')],
    });
    expect(findResource(shared, '/x')?.kind).toBe('topic');
    expect(findResource(shared, 'node:/x')?.kind).toBe('node');
  });
});
