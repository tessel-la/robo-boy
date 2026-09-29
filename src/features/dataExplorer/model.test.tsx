import { describe, expect, it } from 'vitest';
import { boundedPreview, decodeResources, RuleMonitor, ruleIssues, sanitizeExplorerConfig } from './model';
import { makeGraph } from './ResourceGraph';
import ValueTree, { matchesField } from './ValueTree';
import TrendChart, { niceCeiling } from './TrendChart';
import { matchesFilters } from './DataExplorerPanel';
import { render } from '@testing-library/react';
import type { InspectionSnapshot, Resource } from './types';

describe('inspection data boundaries', () => {
  it('bounds large binary messages and circular objects without copying their payload', () => {
    const cloud = { data: new Uint8Array(8_000_000), header: { frame_id: 'map' } };
    const result = boundedPreview(cloud);
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.value).length).toBeLessThan(1000);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => JSON.stringify(boundedPreview(circular))).not.toThrow();
  });
  it('restores sorting and column widths, migrating the old publisher sort', () => {
    expect(sanitizeExplorerConfig({ sort: 'publishers' })).toMatchObject({ sort: 'providers', sortDir: 'asc' });
    expect(sanitizeExplorerConfig({ sort: 'count' })).toMatchObject({ sort: 'providers' });
    expect(
      sanitizeExplorerConfig({ sort: 'consumers', sortDir: 'desc', columns: { providers: 5, rate: 9999 } })
    ).toMatchObject({
      sort: 'consumers',
      sortDir: 'desc',
      columns: { providers: 44, consumers: 56, rate: 240 },
    });
    expect(sanitizeExplorerConfig({ columns: { count: 'wide' } }).columns).toEqual({
      providers: 56,
      consumers: 56,
      rate: 76,
    });
  });
  it('sanitizes restored state and malformed graph data', () => {
    const config = sanitizeExplorerConfig({
      watched: Array.from({ length: 100 }, (_, i) => `/topic${i}`),
      rules: [{ topic: '/speed', minHz: NaN, maxHz: -1 }],
      positions: { a: { x: Infinity, y: 0 } },
    });
    expect(config.watched).toHaveLength(32);
    expect(config.rules).toEqual([{ topic: '/speed' }]);
    expect(config.positions).toEqual({});
    expect(
      decodeResources([null, { kind: 'service', name: '/reset', schemas: { Request: null }, clients: NaN }])
    ).toMatchObject([{ schemas: { Request: {} } }]);
  });
  it('does not turn unavailable counts or warming measurements into failures', () => {
    const snapshot = { resources: [], metrics: {} } as unknown as InspectionSnapshot;
    expect(ruleIssues({ topic: '/speed', minPublishers: 1, silenceSec: 1 }, snapshot)).toEqual([]);
    snapshot.metrics['/speed'] = {
      source: 'host',
      rate: 0,
      bytesPerSec: 0,
      age: null,
      count: 0,
      window: 10,
      warming: false,
      observed: 10,
    };
    expect(ruleIssues({ topic: '/speed', minHz: 5, silenceSec: 1 }, snapshot)).toEqual([
      'No message since watching began (10 s)',
      'Rate 0 Hz; expected ≥ 5',
    ]);
    // While warming the rate is not judged, but a silence already longer than the timeout is.
    snapshot.metrics['/speed'].warming = true;
    expect(ruleIssues({ topic: '/speed', minHz: 5, silenceSec: 1 }, snapshot)).toEqual([
      'No message since watching began (10 s)',
    ]);
    // Unavailable is unknown, never a failure.
    snapshot.metrics['/speed'] = { ...snapshot.metrics['/speed'], unavailable: 'Not measured: probe budget full' };
    expect(ruleIssues({ topic: '/speed', minHz: 5, silenceSec: 1 }, snapshot)).toEqual([]);
  });
  it('judges silence longer than the 10-second window by observed time', () => {
    const snapshot = { resources: [], metrics: {} } as unknown as InspectionSnapshot;
    const metric = (observed: number) => ({
      source: 'host' as const,
      rate: 0,
      bytesPerSec: 0,
      age: null,
      count: 0,
      window: 10,
      observed,
    });
    snapshot.metrics['/map'] = metric(20);
    expect(ruleIssues({ topic: '/map', silenceSec: 30 }, snapshot)).toEqual([]);
    snapshot.metrics['/map'] = metric(31);
    expect(ruleIssues({ topic: '/map', silenceSec: 30 }, snapshot)).toEqual(['No message since watching began (31 s)']);
  });
  it('does not claim a browser rate above its throttle ceiling', () => {
    const snapshot = { resources: [], metrics: {} } as unknown as InspectionSnapshot;
    snapshot.metrics['/scan'] = {
      source: 'browser',
      rate: 10,
      bytesPerSec: null,
      age: 0.05,
      count: 100,
      window: 10,
      ceiling: 10,
      observed: 12,
    };
    expect(ruleIssues({ topic: '/scan', maxHz: 5 }, snapshot)).toEqual([]);
    expect(ruleIssues({ topic: '/scan', minHz: 5 }, snapshot)).toEqual([]);
  });
  it('reports and clears rule violations only after a grace period', () => {
    const monitor = new RuleMonitor(3000);
    const rules = [{ topic: '/speed', minHz: 5 }];
    const at = (rate: number) =>
      ({
        resources: [],
        metrics: { '/speed': { source: 'host', rate, bytesPerSec: 0, age: 0, count: 50, window: 10, observed: 20 } },
      }) as unknown as InspectionSnapshot;
    expect(monitor.evaluate(rules, at(10), 0).states.get('/speed')?.issues).toEqual([]);
    // One late window does not flip the rule.
    expect(monitor.evaluate(rules, at(2), 1000).states.get('/speed')?.issues).toEqual([]);
    expect(monitor.evaluate(rules, at(10), 2000).states.get('/speed')?.issues).toEqual([]);
    // A sustained drop is reported once it has lasted 3 s, with one change event.
    expect(monitor.evaluate(rules, at(2), 3000).changes).toEqual([]);
    const raised = monitor.evaluate(rules, at(2), 6000);
    expect(raised.states.get('/speed')).toEqual({ issues: ['Rate 2 Hz; expected ≥ 5'], since: 6000 });
    expect(raised.changes).toEqual([{ topic: '/speed', issues: ['Rate 2 Hz; expected ≥ 5'] }]);
    // Recovery is confirmed the same way.
    expect(monitor.evaluate(rules, at(10), 7000).states.get('/speed')?.issues).toHaveLength(1);
    const cleared = monitor.evaluate(rules, at(10), 10000);
    expect(cleared.states.get('/speed')?.issues).toEqual([]);
    expect(cleared.changes).toEqual([{ topic: '/speed', issues: [] }]);
    // Removed rules are forgotten.
    expect(monitor.evaluate([], at(2), 11000).states.size).toBe(0);
  });
  it('draws topics publisher → subscriber and services/actions client → server', () => {
    const resources = decodeResources([
      { name: '/move', kind: 'action', providers: ['/server'], consumers: ['/client'] },
      { name: '/reset', kind: 'service', providers: ['/server'], consumers: ['/client'] },
      { name: '/scan', kind: 'topic', providers: ['/lidar'], consumers: ['/nav'], publishers: 1, subscribers: 2 },
      { name: '/lonely', kind: 'node' },
    ]);
    const edges = (kind: 'action' | 'service' | 'topic') =>
      makeGraph(resources, '', kind, '', {}).edges.map(edge => [edge.source, edge.target]);
    expect(edges('action')).toEqual([
      ['node:/client', 'action:/move'],
      ['action:/move', 'node:/server'],
    ]);
    expect(edges('service')).toEqual([
      ['node:/client', 'service:/reset'],
      ['service:/reset', 'node:/server'],
    ]);
    expect(edges('topic')).toEqual([
      ['node:/lidar', 'topic:/scan'],
      ['topic:/scan', 'node:/nav'],
    ]);
    const topicGraph = makeGraph(resources, '', 'topic', '', {}, { observed: new Set(['/scan']) });
    expect(topicGraph.nodes.find(node => node.id === 'topic:/scan')?.data.label).toBe('TOPIC  /scan · 1 → 2');
    expect(topicGraph.edges.every(edge => edge.className?.includes('is-observed'))).toBe(true);
    // Senders sit on the left, receivers on the right.
    const actionGraph = makeGraph(resources, '', 'action', '', {});
    expect(actionGraph.nodes.find(node => node.id === 'node:/client')?.position.x).toBe(0);
    expect(actionGraph.nodes.find(node => node.id === 'node:/server')?.position.x).toBe(580);
    // A focused node without connections is still drawn.
    expect(makeGraph(resources, 'node:/lonely', 'node', '', {}).nodes.map(node => node.id)).toEqual(['node:/lonely']);
    const many = Array.from({ length: 2000 }, (_, i) => ({ ...resources[0], id: `action:/a${i}`, name: `/a${i}` }));
    expect(makeGraph(many, '', 'action', '', {}).nodes.length).toBeLessThanOrEqual(180);
    expect(makeGraph(many, '', 'action', '', {}).truncated).toBe(true);
  });
});

describe('value tree', () => {
  it('renders bounded previews, whose objects have no prototype, without throwing', () => {
    const preview = boundedPreview({ data: 1.5, header: { frame_id: 'base' }, ranges: [1, 2] }).value;
    expect(Object.getPrototypeOf(preview)).toBeNull();
    const { container } = render(<ValueTree value={preview} onCopy={() => undefined} />);
    expect(container.textContent).toContain('1.5');
    expect(container.textContent).toContain('header');
  });
});

describe('message field search', () => {
  it('matches a field by path and keeps its parents', () => {
    const message = { header: { frame_id: 'map' }, pose: { position: { x: 1, y: 2 } }, ranges: [1, 2] };
    expect(matchesField(message.pose, 'pose', 'position.x')).toBe(true);
    expect(matchesField(message.header, 'header', 'position')).toBe(false);
    expect(matchesField(message.ranges, 'ranges', 'ranges[1]')).toBe(true);
  });
});

describe('traffic history chart', () => {
  it('scales from zero to a round ceiling so a steady rate is not drawn at the top edge', () => {
    expect(niceCeiling(58)).toBe(100);
    expect(niceCeiling(697)).toBe(1000);
    expect(niceCeiling(1.5)).toBe(2);
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(Number.NaN)).toBe(1);
  });
  it('labels the scale, the span and the latest value, and waits for a second sample', () => {
    const format = (value: number) => `${value} Hz`;
    const one = render(<TrendChart points={[{ time: 0, value: 50 }]} label="Rate" format={format} />);
    expect(one.getByText('Collecting history…')).toBeTruthy();
    one.unmount();
    const view = render(
      <TrendChart
        points={[
          { time: 0, value: 50 },
          { time: 10_000, value: 50 },
        ]}
        label="Rate"
        format={format}
      />
    );
    expect(view.getByText('100 Hz')).toBeTruthy();
    expect(view.getByText('10 s ago')).toBeTruthy();
    expect(view.getByRole('img', { name: 'Rate: now 50 Hz' })).toBeTruthy();
  });
});

describe('list filters', () => {
  const config = { showHidden: false, query: '', watched: ['/fast'] };
  const resource = (kind: Resource['kind'], name: string) =>
    ({ id: `${kind}:${name}`, kind, name, types: [], providers: [], consumers: [] }) as Resource;
  it('keeps services, actions and nodes when only watched topics are shown', () => {
    expect(matchesFilters(resource('topic', '/fast'), config, true, false)).toBe(true);
    expect(matchesFilters(resource('topic', '/slow'), config, true, false)).toBe(false);
    expect(matchesFilters(resource('service', '/reset'), config, true, false)).toBe(true);
    expect(matchesFilters(resource('action', '/dock'), config, true, false)).toBe(true);
    expect(matchesFilters(resource('node', '/robot'), config, true, false)).toBe(true);
  });
});
