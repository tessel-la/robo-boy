import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  FiActivity,
  FiArrowLeft,
  FiCopy,
  FiDownload,
  FiEye,
  FiFilter,
  FiLayers,
  FiGitBranch,
  FiHeart,
  FiPause,
  FiPlay,
  FiRefreshCw,
  FiSearch,
  FiStar,
  FiX,
} from 'react-icons/fi';
import type { Ros } from 'roslib';
import type { RoboBoyJsonObject } from '../../panels/types';
import type { ReplaySession } from '../recordReplay/ReplaySession';
import { emptySnapshot as createEmptySnapshot, getInspectionSession } from './InspectionSession';
import {
  ageLabel,
  bytesLabel,
  isInfrastructure,
  numberLabel,
  RuleMonitor,
  sanitizeExplorerConfig,
  type RuleState,
} from './model';
import {
  GOAL_STATUS,
  type ExplorerColumn,
  type ExplorerConfig,
  type Metric,
  type Resource,
  type ResourceKind,
  type SchemaField,
} from './types';
import ValueTree from './ValueTree';
import TrendChart from './TrendChart';
import TopicActions, { viewFor } from './TopicActions';
import ResourceList, { BulkBar, type ListColumns } from './ResourceList';
import ResourceGraph, { isInfrastructureNode } from './ResourceGraph';
import HealthView, { downloadJson, type HealthSection } from './HealthView';
import {
  applyExplorerSettings,
  DATA_EXPLORER_SETTINGS_HELP,
  describeDataExplorer,
  type LogQuery,
} from './assistantBridge';
import type { PanelSettingsBridge } from '../assistant/types';
import './DataExplorerPanel.css';

export interface ExplorerOpenRequest {
  panel: 'timeSeries' | 'camera' | '3d' | 'tfTree' | 'recordReplay';
  topic: string;
  /** Several topics at once, for recording settings. */
  topics?: string[];
  messageType: string;
  fieldPath?: string;
  visualizationType?: string;
}
interface Props {
  ros: Ros | null;
  connected: boolean;
  generation: number;
  isActive: boolean;
  replaySession: ReplaySession;
  replayGeneration: number;
  state?: RoboBoyJsonObject;
  onStateChange: (value: RoboBoyJsonObject) => void;
  onOpen: (request: ExplorerOpenRequest) => void;
  /** Lets the AI assistant read what the panel shows and change its settings. */
  panelId?: string;
  onRegisterAssistantBridge?: (panelId: string, bridge: PanelSettingsBridge | null) => void;
}
const EMPTY = createEmptySnapshot();
const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
const kindLabels: Record<ResourceKind, string> = {
  topic: 'Topics',
  service: 'Services',
  action: 'Actions',
  node: 'Nodes',
};
/** A rate as the source can honestly state it: unknown, a lower bound at a throttle ceiling, or a value. */
export const rateLabel = (metric: Metric | undefined, suffix = '') => {
  if (!metric || metric.unavailable || metric.rate == null) return '—';
  if (metric.ceiling != null && metric.rate >= metric.ceiling * 0.9) return `≥ ${numberLabel(metric.ceiling)}${suffix}`;
  return numberLabel(metric.rate, suffix);
};
/** Resources shown by the list and the graph alike: one filter, so the two views never disagree. */
export const matchesFilters = (
  resource: Resource,
  config: Pick<ExplorerConfig, 'showHidden' | 'query' | 'watched'>,
  onlyWatched: boolean,
  onlyMissing: boolean
) =>
  (config.showHidden || !isInfrastructure(resource)) &&
  `${resource.name} ${resource.types.join(' ')}`.toLowerCase().includes(config.query.toLowerCase()) &&
  // Only topics can be watched, so this filter leaves services, actions and nodes alone.
  (!onlyWatched || resource.kind !== 'topic' || config.watched.includes(resource.name)) &&
  (!onlyMissing ||
    resource.publishers === 0 ||
    resource.subscribers === 0 ||
    resource.servers === 0 ||
    resource.clients === 0);

function SchemaTree({ fields }: { fields: SchemaField[] }) {
  return (
    <ul className="de-schema-tree">
      {fields.map(field => (
        <li key={field.name}>
          {field.fields?.length ? (
            <details>
              <summary>
                <strong>{field.name}</strong> <code>{field.type}</code>
              </summary>
              <SchemaTree fields={field.fields} />
            </details>
          ) : (
            <span>
              <strong>{field.name}</strong> <code>{field.type}</code>
              {field.unresolved && <small className="de-muted"> · definition unavailable</small>}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Sparkline({ points, label }: { points: number[]; label: string }) {
  const max = Math.max(...points, 1);
  const line = points
    .map((value, index) => `${(index * 100) / Math.max(1, points.length - 1)},${27 - (value * 24) / max}`)
    .join(' ');
  return (
    <svg className="de-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={line} />
    </svg>
  );
}

export default function DataExplorerPanel({
  ros,
  connected,
  generation,
  isActive,
  replaySession,
  replayGeneration,
  state,
  onStateChange,
  onOpen,
  panelId,
  onRegisterAssistantBridge,
}: Props) {
  const [config, setConfig] = useState(() => sanitizeExplorerConfig(state?.config));
  const [inspectorTab, setInspectorTab] = useState('value');
  const [frozen, setFrozen] = useState<{ topic: string; value: unknown; previous?: unknown }>();
  const [notice, setNotice] = useState('');
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [visible, setVisible] = useState(!document.hidden);
  const [intersecting, setIntersecting] = useState(true);
  const [onlyWatched, setOnlyWatched] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [sortTick, setSortTick] = useState(0);
  const [fieldQuery, setFieldQuery] = useState('');
  const [healthSection, setHealthSection] = useState<HealthSection>('diagnostics');
  const root = useRef<HTMLElement>(null);
  const stateRef = useRef(state?.config);
  const owner = useId();
  const replay = config.source === 'follow' && replaySession.source.ros ? replaySession : undefined;
  const sourceRos = replay?.source.ros ?? (connected ? ros : null);
  const session = useMemo(() => (sourceRos ? getInspectionSession(sourceRos) : undefined), [sourceRos]);
  const snapshot = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? emptySnapshot);
  const active = isActive && visible && intersecting;
  const demand = useMemo(
    () => ({
      watch: [...new Set([...config.watched, ...config.rules.map(rule => rule.topic)])],
      selected: config.selected,
      health: config.view === 'health',
      diagnosticTopic: config.diagnosticTopic,
    }),
    [config.watched, config.rules, config.selected, config.view, config.diagnosticTopic]
  );
  const demandRef = useRef(demand);
  demandRef.current = demand;
  useEffect(() => {
    if (state?.config !== stateRef.current) {
      stateRef.current = state?.config;
      setConfig(sanitizeExplorerConfig(state?.config));
    }
  }, [state?.config]);
  // Short tiles (stacked or split windows) get a compact header so the list keeps room for rows.
  const [short, setShort] = useState(false);
  // Narrow tiles show either the list or the inspector (matches the 700 px container query).
  const [narrow, setNarrow] = useState(false);
  const [compact, setCompact] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !(event.target as Element | null)?.closest?.('.de-filter-menu')
      )
        setFiltersOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [filtersOpen]);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setShort((entry?.contentRect.height ?? 1000) < 520);
      setNarrow((entry?.contentRect.width ?? 1000) <= 700);
      setCompact((entry?.contentRect.width ?? 1000) <= 520);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(entries => setIntersecting(entries[0]?.isIntersecting ?? true))
        : undefined;
    if (root.current) observer?.observe(root.current);
    return () => {
      document.removeEventListener('visibilitychange', change);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!session || !active) return;
    return session.acquire(
      owner,
      demandRef.current,
      replay?.snapshot.info
        ? {
            info: replay.snapshot.info,
            clock: () => Number(replay.snapshot.info!.start / 1000n) / 1000 + replay.snapshot.position * 1000,
          }
        : undefined
    );
  }, [session, active, owner, replay, generation, replayGeneration]);
  useEffect(() => {
    session?.update(owner, demand);
  }, [session, owner, demand]);
  useEffect(() => {
    setFrozen(undefined);
    setFieldQuery('');
    setInspectorTab('value');
  }, [config.selected, sourceRos]);
  // A selection belongs to one kind and one source.
  useEffect(() => setChecked(new Set()), [config.kind, sourceRos]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Merge into the latest configuration, not this render's copy, so two changes in one event both apply.
  const latestConfig = useRef(config);
  latestConfig.current = config;
  const change = (patch: Partial<ExplorerConfig>) => {
    const next = sanitizeExplorerConfig({ ...latestConfig.current, ...patch });
    latestConfig.current = next;
    setConfig(next);
    const value = JSON.parse(JSON.stringify(next)) as RoboBoyJsonObject;
    stateRef.current = value;
    onStateChange({ config: value });
  };
  const select = (id: string) => change({ selected: id });
  const copy = useCallback((text: string) => {
    if (!navigator.clipboard) {
      setNotice('Clipboard is unavailable in this browser.');
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => setNotice('Copied'),
      () => setNotice('Clipboard is unavailable in this browser.')
    );
  }, []);
  const selected = snapshot.resources.find(resource => resource.id === config.selected);
  const kindCounts = useMemo(() => {
    const counts: Record<ResourceKind, number> = { topic: 0, service: 0, action: 0, node: 0 };
    for (const resource of snapshot.resources)
      if (config.showHidden || !isInfrastructure(resource)) counts[resource.kind] += 1;
    return counts;
  }, [snapshot.resources, config.showHidden]);
  // A recording has no watch probes and no endpoint counts, so these filters only apply live.
  const liveWatched = onlyWatched && !replay;
  const liveMissing = onlyMissing && !replay;
  // Metrics intentionally do not trigger resorting while a user reads a row.
  const orderingMetrics = useRef(snapshot.metrics);
  const previousSortTick = useRef(sortTick);
  if (previousSortTick.current !== sortTick) {
    orderingMetrics.current = snapshot.metrics;
    previousSortTick.current = sortTick;
  }
  // Columns that mean something for each kind: rates exist only for topics.
  const recordedSeconds =
    replay?.snapshot.info && replay.snapshot.info.end > replay.snapshot.info.start
      ? Number(replay.snapshot.info.end - replay.snapshot.info.start) / 1e9
      : null;
  const nodeTopicCounts = useMemo(() => {
    const counts = new Map<string, { publishes: number; subscribes: number }>();
    for (const resource of snapshot.resources) {
      if (resource.kind !== 'topic') continue;
      for (const [nodes, key] of [
        [resource.providers, 'publishes'],
        [resource.consumers, 'subscribes'],
      ] as const)
        for (const node of nodes) {
          const entry = counts.get(node) ?? { publishes: 0, subscribes: 0 };
          entry[key] += 1;
          counts.set(node, entry);
        }
    }
    return counts;
  }, [snapshot.resources]);
  const countOf = (resource: Resource, column: 'providers' | 'consumers'): number | null =>
    resource.kind === 'node'
      ? (nodeTopicCounts.get(resource.name)?.[column === 'providers' ? 'publishes' : 'subscribes'] ?? 0)
      : replay && resource.kind === 'topic'
        ? column === 'providers'
          ? (resource.recordedCount ?? null)
          : null
        : column === 'providers'
          ? (resource.publishers ?? resource.servers ?? null)
          : (resource.subscribers ?? resource.clients ?? null);
  const rateOf = (resource: Resource, metrics = snapshot.metrics): number | null =>
    replay
      ? resource.recordedCount != null && recordedSeconds
        ? resource.recordedCount / recordedSeconds
        : null
      : (metrics[resource.name]?.rate ?? null);
  const resources = useMemo(() => {
    const direction = config.sortDir === 'desc' ? -1 : 1;
    // Unknown values sort last in either direction.
    const byNumber = (a: number | null, b: number | null) =>
      a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * direction;
    return snapshot.resources
      .filter(resource => resource.kind === config.kind && matchesFilters(resource, config, liveWatched, liveMissing))
      .sort(
        (a, b) =>
          Number(config.pinned.includes(b.id)) - Number(config.pinned.includes(a.id)) ||
          (config.sort === 'rate'
            ? byNumber(rateOf(a, orderingMetrics.current), rateOf(b, orderingMetrics.current))
            : config.sort === 'name'
              ? a.name.localeCompare(b.name) * direction
              : byNumber(countOf(a, config.sort), countOf(b, config.sort))) ||
          a.name.localeCompare(b.name)
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rates re-sort only when the user asks (sortTick)
  }, [snapshot.resources, config, liveWatched, liveMissing, sortTick, nodeTopicCounts, recordedSeconds]);
  const sortBy = (column: ExplorerConfig['sort']) => {
    orderingMetrics.current = snapshot.metrics;
    setSortTick(tick => tick + 1);
    const numeric = column !== 'name';
    change({
      sort: column,
      // A new numeric column starts with the largest values; clicking again flips the direction.
      sortDir: config.sort === column ? (config.sortDir === 'asc' ? 'desc' : 'asc') : numeric ? 'desc' : 'asc',
    });
  };
  // The Actions column only makes room for an open-in-a-view icon when a shown topic has one.
  const anyView = resources.some(resource => resource.types.length === 1 && viewFor(resource.types[0]));
  const listColumns: ListColumns = {
    cells:
      config.kind === 'topic'
        ? replay
          ? [
              { column: 'providers', label: 'Msgs', title: 'Messages in this recording' },
              { column: 'rate', label: 'Avg Hz', title: 'Whole-file average rate' },
            ]
          : [
              { column: 'providers', label: 'Pub', title: 'Publishers' },
              { column: 'consumers', label: 'Sub', title: 'Subscribers' },
              { column: 'rate', label: 'Hz', title: 'Observed rate of watched topics' },
            ]
        : config.kind === 'node'
          ? [
              { column: 'providers', label: 'Pub', title: 'Topics this node publishes' },
              { column: 'consumers', label: 'Sub', title: 'Topics this node subscribes to' },
            ]
          : [
              {
                column: 'providers',
                label: 'Srv',
                title: config.kind === 'action' ? 'Action server nodes' : 'Servers',
              },
              {
                column: 'consumers',
                label: 'Cli',
                title: config.kind === 'action' ? 'Action client nodes' : 'Clients',
              },
            ],
    actionSlots: config.kind === 'topic' ? (replay ? (anyView ? 1 : 0) : anyView ? 4 : 3) : 0,
  };
  const cellValue = (resource: Resource, column: ExplorerColumn) => {
    if (column === 'rate')
      return replay
        ? { text: numberLabel(rateOf(resource)), title: 'Whole-file average, independent of playback speed' }
        : {
            text: rateLabel(snapshot.metrics[resource.name]),
            title: snapshot.metrics[resource.name]?.unavailable,
            trend: snapshot.trends[resource.name]?.map(point => point.rate),
          };
    const title =
      resource.kind === 'node' || (replay && resource.kind === 'topic')
        ? undefined
        : resource.countKind === 'endpoints'
          ? 'Endpoint count'
          : resource.countKind === 'nodes'
            ? 'Participating node count'
            : 'Count unavailable';
    return { text: numberLabel(countOf(resource, column)), title };
  };
  const checkedResources = snapshot.resources.filter(resource => checked.has(resource.id));
  const checkedTopics = checkedResources.filter(resource => resource.kind === 'topic');
  const setCheckedIds = (ids: string[], value: boolean) =>
    setChecked(current => {
      const next = new Set(current);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  // Rules are judged with a grace period so a single late sample does not flip their state.
  const monitor = useRef(new RuleMonitor());
  const [ruleStates, setRuleStates] = useState<Map<string, RuleState>>(() => new Map());
  useEffect(() => {
    monitor.current = new RuleMonitor();
  }, [sourceRos]);
  useEffect(() => {
    if (!session) return;
    const { states, changes } = monitor.current.evaluate(config.rules, snapshot, snapshot.now);
    setRuleStates(states);
    for (const change of changes)
      session.recordEvent(
        change.issues.length
          ? `Rule ${change.topic}: ${change.issues.join('; ')}`
          : `Rule ${change.topic}: back within limits`,
        change.issues.length ? 1 : 0
      );
  }, [session, snapshot, config.rules]);
  const graphResources = useMemo(
    () =>
      snapshot.resources.filter(
        resource => resource.kind === 'node' || matchesFilters(resource, config, liveWatched, liveMissing)
      ),
    [snapshot.resources, config, liveWatched, liveMissing]
  );
  const observedTopics = useMemo(
    () =>
      new Set(
        Object.entries(snapshot.metrics)
          .filter(([, metric]) => (metric.rate ?? 0) > 0)
          .map(([name]) => name)
      ),
    [snapshot.metrics]
  );
  // While replay is open, Time Series, 3D, Camera and TF follow the recording, so opening them from
  // a live inspection would show recorded data under a live label.
  const liveDuringReplay = !replay && Boolean(replaySession.source.ros);
  // The AI assistant's bridge is registered once and reads the latest state through this ref, so
  // a new snapshot every half second does not re-register it.
  const assistantLogQuery = useRef<LogQuery>();
  const assistantState = useRef({
    snapshot,
    config,
    ruleStates,
    replay,
    recordedSeconds,
    liveDuringReplay,
    active,
    connected,
    change,
    session,
  });
  assistantState.current = {
    snapshot,
    config,
    ruleStates,
    replay,
    recordedSeconds,
    liveDuringReplay,
    active,
    connected,
    change,
    session,
  };
  useEffect(() => {
    if (!panelId || !onRegisterAssistantBridge) return;
    // The session's own snapshot is newer than the one this render holds.
    const latestSnapshot = () => assistantState.current.session?.getSnapshot() ?? assistantState.current.snapshot;
    const graphReady = () => {
      const snapshot = latestSnapshot();
      return !assistantState.current.session || (!snapshot.loading && snapshot.resources.length > 0);
    };
    const waitForGraph = (timeoutMs: number) =>
      new Promise<void>(resolve => {
        const session = assistantState.current.session;
        if (!session) return resolve();
        const done = () => {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        const unsubscribe = session.subscribe(() => {
          if (graphReady()) done();
        });
      });
    const bridge: PanelSettingsBridge = {
      panelType: 'dataExplorer',
      settingsHelp: DATA_EXPLORER_SETTINGS_HELP,
      describe: () => {
        const current = assistantState.current;
        return describeDataExplorer({
          snapshot: latestSnapshot(),
          // `change` updates this ref at once; the follow-up turn can run before React re-renders.
          config: latestConfig.current,
          ruleStates: current.ruleStates,
          recording: current.replay?.snapshot.info
            ? { name: current.replay.snapshot.info.name, seconds: current.recordedSeconds }
            : undefined,
          liveDuringReplay: current.liveDuringReplay,
          active: current.active,
          connected: current.connected || Boolean(current.replay),
          logQuery: assistantLogQuery.current,
        });
      },
      apply: async settings => {
        // A panel the assistant just added is still discovering: wait for its first graph, so the
        // request is checked against real topics and the next turn sees what it selected.
        if (!graphReady()) await waitForGraph(4000);
        const current = assistantState.current;
        const result = applyExplorerSettings(latestConfig.current, settings, latestSnapshot(), {
          recording: Boolean(current.replay),
        });
        if (Object.keys(result.patch).length) current.change(result.patch);
        if (result.refresh) current.session?.refresh();
        if (result.logQuery) assistantLogQuery.current = result.logQuery;
        return result.outcomes;
      },
    };
    onRegisterAssistantBridge(panelId, bridge);
    return () => onRegisterAssistantBridge(panelId, null);
  }, [panelId, onRegisterAssistantBridge]);
  const watchMany = (names: string[]) => {
    // Like the row icon, the bulk button toggles: when every selected topic is watched, it unwatches them.
    if (names.length && names.every(name => config.watched.includes(name))) {
      change({ watched: config.watched.filter(name => !names.includes(name)) });
      return;
    }
    const wanted = names.filter(name => !config.watched.includes(name));
    const room = 32 - config.watched.length;
    if (wanted.length > room)
      setNotice(`Watch limit is 32 topics: watching ${Math.max(0, room)} of the ${wanted.length} selected.`);
    if (room > 0) change({ watched: [...config.watched, ...wanted.slice(0, room)] });
  };
  const addRules = (names: string[]) => {
    const wanted = names.filter(name => !config.rules.some(rule => rule.topic === name));
    const room = 32 - config.rules.length;
    const added = wanted.slice(0, Math.max(0, room)).map(topic => ({ topic, silenceSec: 5 }));
    if (added.length) change({ rules: [...config.rules, ...added] });
    setNotice(
      `${added.length} health rule${added.length === 1 ? '' : 's'} added (alert after 5 s of silence)${wanted.length > added.length ? '; the 32-rule limit was reached' : ''}. Set thresholds in Health → Rules.`
    );
  };
  const watch = (name: string) => {
    if (!config.watched.includes(name) && config.watched.length >= 32) {
      setNotice('Watch limit reached (32 topics). Unwatch a topic first.');
      return;
    }
    change({
      watched: config.watched.includes(name) ? config.watched.filter(item => item !== name) : [...config.watched, name],
    });
  };
  const metric = selected && snapshot.metrics[selected.name];
  const previewTopic =
    selected?.kind === 'action'
      ? `${selected.name}/_action/${inspectorTab === 'feedback' ? 'feedback' : 'status'}`
      : (selected?.name ?? '');
  const preview = snapshot.previews[previewTopic];
  const displayed = frozen?.topic === previewTopic ? frozen : preview;
  const openFor = (
    resource: Resource,
    panel: ExplorerOpenRequest['panel'],
    options: { fieldPath?: string; visualizationType?: string } = {}
  ) => {
    if (liveDuringReplay && panel !== 'recordReplay') {
      setNotice('Visualizations follow the open recording. Close it to view live data there.');
      return;
    }
    onOpen({ panel, topic: resource.name, messageType: resource.types[0] ?? '', ...options });
  };
  const toggleRule = (resource: Resource) => {
    if (config.rules.some(rule => rule.topic === resource.name)) {
      // The rule already exists: show it where it can be edited.
      setHealthSection('rules');
      change({ view: 'health' });
      return;
    }
    if (config.rules.length >= 32) {
      setNotice('Rule limit reached (32 topics). Remove a rule first.');
      return;
    }
    change({ rules: [...config.rules, { topic: resource.name, silenceSec: 5 }] });
    setNotice('Health rule added (alerts after 5 s of silence). Set thresholds in Health → Rules.');
  };
  const topicActions = (resource: Resource) => (
    <TopicActions
      resource={resource}
      replay={Boolean(replay)}
      viewsDisabled={liveDuringReplay}
      watched={config.watched.includes(resource.name)}
      hasRule={config.rules.some(rule => rule.topic === resource.name)}
      onWatch={() => watch(resource.name)}
      onOpen={(panel, visualizationType) => openFor(resource, panel, { visualizationType })}
      onRule={() => toggleRule(resource)}
    />
  );
  const inspector = selected && (
    <aside className="de-inspector" aria-label={`${selected.name} inspector`}>
      <header className="de-inspector-heading">
        <button aria-label="Back to resources" title="Back to resources" onClick={() => select('')}>
          <FiArrowLeft />
        </button>
        <div>
          <strong>{selected.name}</strong>
          <small>{selected.types.join(', ') || 'Type not available'}</small>
        </div>
        <button
          title={config.pinned.includes(selected.id) ? 'Unpin' : 'Pin to the top of the list'}
          aria-label={`${config.pinned.includes(selected.id) ? 'Unpin' : 'Pin'} ${selected.name}`}
          aria-pressed={config.pinned.includes(selected.id)}
          onClick={() =>
            change({
              pinned: config.pinned.includes(selected.id)
                ? config.pinned.filter(id => id !== selected.id)
                : [...config.pinned, selected.id],
            })
          }
        >
          <FiStar />
        </button>
        <button title="Copy resource name" aria-label="Copy resource name" onClick={() => copy(selected.name)}>
          <FiCopy />
        </button>
      </header>
      {selected.kind === 'topic' && <div className="de-inspector-actions">{topicActions(selected)}</div>}
      <div className="de-badges">
        <span>{selected.kind}</span>
        <span>
          {selected.countKind === 'nodes'
            ? 'Counts are participating nodes'
            : selected.countKind === 'endpoints'
              ? 'Counts are endpoints'
              : replay
                ? 'Topology not recorded'
                : 'Endpoint counts unavailable'}
        </span>
      </div>
      {selected.error && (
        <p role="alert" className="de-warning">
          {selected.error}
        </p>
      )}
      <nav className="de-subtabs" aria-label="Resource details">
        {(selected.kind === 'topic'
          ? ['value', 'endpoints', 'traffic', 'schema']
          : selected.kind === 'action'
            ? ['value', 'feedback', 'endpoints', 'schema']
            : ['endpoints', 'schema']
        ).map(tab => (
          <button
            key={tab}
            aria-pressed={
              (inspectorTab === 'value' && (selected.kind === 'service' || selected.kind === 'node')
                ? 'endpoints'
                : inspectorTab) === tab
            }
            onClick={() => setInspectorTab(tab)}
          >
            {tab === 'value' && selected.kind === 'action' ? 'Goal status' : tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>
      {((inspectorTab === 'value' && (selected.kind === 'topic' || selected.kind === 'action')) ||
        inspectorTab === 'feedback') && (
        <>
          {selected.kind === 'action' && inspectorTab === 'value' && (
            <section className="de-goals" aria-label="Observed goals">
              <h4>Observed goals</h4>
              {(snapshot.goals[selected.name] ?? []).length ? (
                <ol>
                  {(snapshot.goals[selected.name] ?? []).map(goal => (
                    <li key={goal.id}>
                      <span className="de-severity" data-level={goal.status === 6 ? 2 : goal.status === 5 ? 1 : 0}>
                        {GOAL_STATUS[goal.status] ?? `Status ${goal.status}`}
                      </span>
                      <code title={goal.id}>{goal.id.slice(0, 8)}</code>
                      <small>
                        {ageLabel(Math.max(0, snapshot.now - goal.changedAt) / 1000)} in this state ·{' '}
                        {goal.history.map(step => GOAL_STATUS[step.status] ?? step.status).join(' → ')}
                      </small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="de-muted">No goals seen since inspection started.</p>
              )}
              <p className="de-muted">
                From the action&apos;s status topic, since this inspection started. The robot may drop finished goals
                from its status list.
              </p>
            </section>
          )}
          <div className="de-value-toolbar">
            <label className="de-field-search">
              <FiSearch aria-hidden="true" />
              <input
                type="search"
                aria-label="Find a field"
                placeholder="Find a field…"
                value={fieldQuery}
                onChange={event => setFieldQuery(event.target.value)}
              />
            </label>
            <button
              aria-label={frozen ? 'Resume message' : 'Freeze message'}
              disabled={!preview}
              onClick={() => setFrozen(frozen ? undefined : { ...preview!, topic: previewTopic })}
            >
              {frozen ? <FiPlay /> : <FiPause />}
              {frozen ? 'Resume' : 'Freeze'}
            </button>
            <button disabled={!displayed} onClick={() => copy(JSON.stringify(displayed?.value, null, 2))}>
              <FiCopy />
              Copy preview
            </button>
          </div>
          {displayed ? (
            <ValueTree
              value={displayed.value}
              previous={displayed.previous}
              query={fieldQuery}
              onCopy={copy}
              onPlot={
                selected.kind === 'topic' && !liveDuringReplay
                  ? path => openFor(selected, 'timeSeries', { fieldPath: path })
                  : undefined
              }
            />
          ) : (
            <p className="de-empty">Waiting for a message…</p>
          )}
          {preview?.truncated && <p className="de-muted">Bounded preview: large arrays and strings are shortened.</p>}
          {selected.kind === 'action' && (
            <p className="de-muted">
              Observed status/feedback only. Other clients’ goal and result payloads are not automatically visible.
            </p>
          )}
        </>
      )}
      {(inspectorTab === 'endpoints' || (inspectorTab === 'value' && ['service', 'node'].includes(selected.kind))) && (
        <>
          {selected.kind !== 'node' && (
            <div className="de-stat-grid">
              <div>
                <strong>{numberLabel(selected.publishers ?? selected.servers)}</strong>
                <span>{selected.kind === 'topic' ? 'Publishers' : 'Servers'}</span>
              </div>
              <div>
                <strong>{numberLabel(selected.subscribers ?? selected.clients)}</strong>
                <span>{selected.kind === 'topic' ? 'Subscribers' : 'Clients'}</span>
              </div>
            </div>
          )}
          {selected.kind === 'node' ? (
            <div className="de-related">
              {selected.instances && selected.instances > 1 && (
                <p className="de-warning">{selected.instances} nodes share this name. Membership may be ambiguous.</p>
              )}
              {snapshot.resources
                .filter(
                  resource => resource.providers.includes(selected.name) || resource.consumers.includes(selected.name)
                )
                .map(resource => (
                  <button key={resource.id} onClick={() => select(resource.id)}>
                    <small>
                      {resource.kind} ·{' '}
                      {resource.providers.includes(selected.name) ? 'provides/publishes' : 'uses/subscribes'}
                    </small>
                    {resource.name}
                  </button>
                ))}
            </div>
          ) : (
            <>
              {(['providers', 'consumers'] as const).map(role => (
                <section className="de-endpoint-group" key={role}>
                  <h4>
                    {role === 'providers'
                      ? selected.kind === 'topic'
                        ? 'Publisher nodes'
                        : 'Server nodes'
                      : selected.kind === 'topic'
                        ? 'Subscriber nodes'
                        : 'Client nodes'}
                  </h4>
                  {selected[role].length ? (
                    selected[role].map(node => (
                      <button key={node} onClick={() => select(`node:${node}`)}>
                        {node}
                      </button>
                    ))
                  ) : (
                    <p className="de-muted">
                      {snapshot.mode === 'host'
                        ? 'None discovered'
                        : replay
                          ? 'Not recorded'
                          : 'Details require the ROS inspection companion'}
                    </p>
                  )}
                </section>
              ))}
            </>
          )}
          {selected.endpoints?.map((endpoint, index) => (
            <details className="de-endpoint" key={`${endpoint.id}:${index}`}>
              <summary>
                {endpoint.role} · {endpoint.node}
                {endpoint.observer && <span className="de-badge">Observer</span>}
              </summary>
              <p className="de-muted">Endpoint {endpoint.id}</p>
              <dl>
                {Object.entries(endpoint.qos).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}
          {selected.compatibility?.map((issue, index) => (
            <p key={index} className="de-warning">
              {issue.publisher} → {issue.subscriber}: {issue.reason}
            </p>
          ))}
          {selected.kind === 'action' && (
            <details className="de-endpoint">
              <summary>Action transport</summary>
              {['send_goal', 'get_result', 'cancel_goal', 'feedback', 'status'].map(suffix => (
                <p key={suffix}>
                  {selected.name}/_action/{suffix}
                </p>
              ))}
            </details>
          )}
          {selected.kind === 'service' && (
            <p className="de-muted">
              Discovery shows presence, not responsiveness. Call contents, rates and latency require enabled service
              introspection.
            </p>
          )}
          {selected.kind === 'topic' && snapshot.mode === 'host' && (
            <p className="de-muted">
              Counts include inspector, recorder and bridge subscriptions. QoS compatibility does not prove delivery.
            </p>
          )}
        </>
      )}
      {inspectorTab === 'schema' && (
        <>
          {selected.schemas ? (
            Object.entries(selected.schemas).map(([part, fields]) => (
              <section key={part} className="de-schema">
                <h4>{part}</h4>
                {fields.length ? <SchemaTree fields={fields} /> : <p className="de-muted">No fields.</p>}
                {selected.constants?.[part]?.length ? (
                  <details className="de-endpoint">
                    <summary>Constants · {selected.constants[part].length}</summary>
                    <dl>
                      {selected.constants[part].map(constant => (
                        <div key={constant.name}>
                          <dt>{constant.name}</dt>
                          <dd>{String(constant.value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </section>
            ))
          ) : selected.definition ? (
            <section className="de-schema">
              <h4>Recorded definition</h4>
              <pre className="de-definition">{selected.definition}</pre>
              <p className="de-muted">Stored in the MCAP file with this channel.</p>
            </section>
          ) : (
            <p className="de-empty">
              {replay
                ? 'This recording does not include a definition for this topic.'
                : snapshot.online
                  ? 'Loading interface fields from the ROS host…'
                  : 'Interface schemas require the ROS inspection companion.'}
            </p>
          )}
        </>
      )}
      {inspectorTab === 'traffic' && (
        <>
          {replay ? (
            <>
              <p className="de-muted">
                {numberLabel(selected.recordedCount)} messages in this recording. Live endpoint counts and measured
                traffic are not recorded.
              </p>
              <p>
                Average recorded rate:{' '}
                {numberLabel(
                  selected.recordedCount != null &&
                    replay.snapshot.info &&
                    replay.snapshot.info.end > replay.snapshot.info.start
                    ? selected.recordedCount / (Number(replay.snapshot.info.end - replay.snapshot.info.start) / 1e9)
                    : undefined,
                  ' Hz'
                )}
              </p>
              <p className="de-muted">Whole-file average; independent of playback speed.</p>
            </>
          ) : (
            <>
              {!metric && (
                <div className="de-unwatched">
                  <p className="de-muted">Not monitored. Watch this topic to measure its rate and bandwidth.</p>
                  <button onClick={() => watch(selected.name)}>
                    <FiEye />
                    Watch this topic
                  </button>
                </div>
              )}
              {metric?.unavailable && <p className="de-warning">{metric.unavailable}</p>}
              {metric && (
                <>
                  <div className="de-stat-grid">
                    <div>
                      <strong>{rateLabel(metric, ' Hz')}</strong>
                      <span>Observed rate</span>
                    </div>
                    <div>
                      <strong>{bytesLabel(metric?.bytesPerSec)}</strong>
                      <span>Serialized payload</span>
                    </div>
                    <div>
                      <strong>{ageLabel(metric?.age)}</strong>
                      <span>Last received</span>
                    </div>
                    <div>
                      <strong>{numberLabel(metric?.count)}</strong>
                      <span>Received messages</span>
                    </div>
                  </div>
                  <p className="de-muted">
                    {metric?.source === 'host'
                      ? 'Observed on ROS host · 10-second rolling window · best-effort probe'
                      : 'Received in the browser · previews are throttled to 10 per second, so “≥ 10 Hz” is a lower bound · not publisher frequency'}
                    {metric?.warming ? ' · Warming up' : ''}
                  </p>
                  <h4>Observed rate</h4>
                  <TrendChart
                    points={(snapshot.trends[selected.name] ?? []).map(point => ({
                      time: point.time,
                      value: point.rate,
                    }))}
                    label="Observed frequency history"
                    format={value => numberLabel(value, ' Hz')}
                  />
                  <h4>Payload traffic</h4>
                  <TrendChart
                    points={(snapshot.trends[selected.name] ?? []).map(point => ({
                      time: point.time,
                      value: point.bytes,
                    }))}
                    label="Payload traffic history"
                    format={bytesLabel}
                  />
                  <dl>
                    {[
                      ['Mean interval', ageLabel(metric?.intervalMean)],
                      ['Shortest interval', ageLabel(metric?.intervalMin)],
                      ['Longest interval', ageLabel(metric?.intervalMax)],
                      ['Interval variation', ageLabel(metric?.jitter)],
                      ['Mean message size', numberLabel(metric?.meanBytes, ' bytes')],
                      ['Largest message', numberLabel(metric?.maxBytes, ' bytes')],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="de-muted">Payload bytes exclude network overhead. Gaps do not prove message loss.</p>
                </>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
  // Watching and endpoint counts only exist live; only topics can be watched.
  const filters = [
    ...(config.kind === 'topic' && !replay
      ? [
          {
            label: 'Show watched topics only',
            Icon: FiEye,
            on: onlyWatched,
            toggle: () => setOnlyWatched(!onlyWatched),
          },
        ]
      : []),
    {
      label: 'Show hidden and infrastructure resources',
      Icon: FiLayers,
      on: config.showHidden,
      toggle: () => change({ showHidden: !config.showHidden }),
    },
    ...(!replay
      ? [
          {
            label: 'Show resources with missing endpoints',
            Icon: FiFilter,
            on: onlyMissing,
            toggle: () => setOnlyMissing(!onlyMissing),
          },
        ]
      : []),
  ];
  // One file with everything the panel knows, so a report can be shared or compared later.
  const exportSnapshot = () =>
    downloadJson('roboboy-inspection.json', {
      source: replay ? 'recording' : snapshot.mode,
      exportedAt: new Date().toISOString(),
      updatedAt: snapshot.updatedAt,
      resources: snapshot.resources,
      metrics: snapshot.metrics,
      diagnostics: snapshot.diagnostics,
      rules: config.rules,
      events: snapshot.events,
      logs: snapshot.logs,
    });
  return (
    <section
      ref={root}
      className="data-explorer-panel"
      data-short={short}
      aria-label="Data Explorer"
      data-selected={Boolean(selected)}
    >
      <header className="de-toolbar">
        <nav className="de-tabs" aria-label="Explorer views">
          {(
            [
              ['resources', FiActivity, 'Resources'],
              ['graph', FiGitBranch, 'Graph'],
              ['health', FiHeart, 'Health'],
            ] as const
          ).map(([view, Icon, label]) => (
            <button
              key={view}
              aria-pressed={config.view === view}
              // On a narrow tile the inspector covers the view, so switching views closes it.
              onClick={() => change(narrow ? { view, selected: '' } : { view })}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="de-source">
          <span className="de-source-dot" data-online={snapshot.online || !!replay} />
          <strong>{replay ? 'Recording' : snapshot.online ? 'ROS host' : 'Browser discovery'}</strong>
          <span>
            {replay
              ? replay.snapshot.info?.name
              : sourceRos
                ? snapshot.online
                  ? liveDuringReplay
                    ? 'Live robot · visualizations follow the recording'
                    : 'Live inspection'
                  : 'Companion unavailable · limited inspection'
                : 'Connect to ROS or open a recording'}
          </span>
          {replaySession.source.ros && ros && (
            <select
              aria-label="Inspection source"
              value={config.source}
              onChange={event => change({ source: event.target.value as ExplorerConfig['source'] })}
            >
              <option value="follow">Follow replay</option>
              <option value="live">Live robot</option>
            </select>
          )}
        </div>
        <button
          className="de-round"
          aria-label="Export inspection snapshot"
          title="Export resources, measurements, diagnostics, rules and logs (JSON)"
          onClick={exportSnapshot}
          disabled={!snapshot.resources.length}
        >
          <FiDownload />
        </button>
        <button
          className="de-round"
          aria-label="Refresh resources"
          title="Refresh resources and re-sort rows by current values"
          onClick={() => {
            // Rows keep their order while values change; refreshing is the moment to re-order them.
            orderingMetrics.current = snapshot.metrics;
            setSortTick(tick => tick + 1);
            if (!replay) session?.refresh();
          }}
          disabled={!sourceRos}
        >
          <FiRefreshCw className={snapshot.loading ? 'de-spin' : ''} />
        </button>
      </header>
      <div className="de-filter-bar">
        <div className="de-search-row">
          <label className="de-search">
            <FiSearch />
            <input
              type="search"
              aria-label="Search resources"
              placeholder={
                config.view === 'health' ? 'Search diagnostics…' : compact ? 'Search…' : 'Search topics, nodes…'
              }
              value={config.query}
              onChange={event => change({ query: event.target.value })}
            />
          </label>
          {config.view !== 'health' &&
            (compact ? (
              // Narrow tiles fold the toggles into one menu so the search keeps its width.
              <div className="de-filter-menu">
                <button
                  className="de-round"
                  title="Filters"
                  aria-label="Filters"
                  aria-expanded={filtersOpen}
                  data-active={filters.some(filter => filter.on)}
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <FiFilter />
                </button>
                {filtersOpen && (
                  <div className="de-filter-popover" role="group" aria-label="Filters">
                    {filters.map(filter => (
                      <label key={filter.label}>
                        <input type="checkbox" checked={filter.on} onChange={filter.toggle} />
                        {filter.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              filters.map(({ label, Icon, on, toggle }) => (
                <button
                  key={label}
                  className="de-round"
                  title={label}
                  aria-label={label}
                  aria-pressed={on}
                  onClick={toggle}
                >
                  <Icon />
                </button>
              ))
            ))}
        </div>
        {config.view !== 'health' && (
          <>
            <select
              className="de-kind-select"
              aria-label="Resource type"
              value={config.kind}
              onChange={event => change({ kind: event.target.value as ResourceKind, selected: '' })}
            >
              {(Object.keys(kindLabels) as ResourceKind[]).map(kind => (
                <option key={kind} value={kind}>
                  {kindLabels[kind]} · {kindCounts[kind]}
                </option>
              ))}
            </select>
            <nav className="de-kind-tabs" aria-label="Resource types">
              {(Object.keys(kindLabels) as ResourceKind[]).map(kind => (
                <button key={kind} aria-pressed={config.kind === kind} onClick={() => change({ kind, selected: '' })}>
                  {kindLabels[kind]}
                  <small>{kindCounts[kind]}</small>
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
      {snapshot.truncated && (
        <p className="de-warning de-inline-notice">Graph exceeds the discovery budget; this is a partial snapshot.</p>
      )}
      {snapshot.errors.length > 0 && (
        <details className="de-errors">
          <summary>
            {snapshot.errors.length} inspection notice{snapshot.errors.length > 1 ? 's' : ''}
          </summary>
          {snapshot.errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </details>
      )}
      {config.view === 'health' ? (
        <HealthView
          snapshot={snapshot}
          config={config}
          ruleStates={ruleStates}
          section={healthSection}
          onSection={setHealthSection}
          onChange={change}
          onSelect={id => change({ selected: id, view: 'resources', kind: 'topic' })}
        />
      ) : (
        <div className="de-content">
          {config.view === 'graph' ? (
            replay ? (
              <p className="de-empty">
                Node, service and action topology was not recorded. Inspect recorded topics in Resources.
              </p>
            ) : (
              <ResourceGraph
                resources={graphResources}
                config={config}
                observed={observedTopics}
                hideNode={config.showHidden ? undefined : isInfrastructureNode}
                onSelect={select}
                onPositions={positions => change({ positions })}
              />
            )
          ) : (
            <ResourceList
              resources={resources}
              config={config}
              columns={listColumns}
              loadingText={
                snapshot.loading
                  ? 'Discovering ROS resources…'
                  : replay && config.kind !== 'topic'
                    ? 'Not recorded in this MCAP.'
                    : 'No resources match this view.'
              }
              checked={checked}
              ruleIssues={resource => (resource.kind === 'topic' ? (ruleStates.get(resource.name)?.issues ?? []) : [])}
              value={cellValue}
              actions={topicActions}
              onSelect={select}
              onCheck={setCheckedIds}
              onSort={sortBy}
              onResize={columns => change({ columns })}
              renderSparkline={(points, label) => <Sparkline points={points} label={label} />}
              bulk={
                <BulkBar
                  count={checkedResources.length}
                  topics={checkedTopics.length > 0}
                  replay={Boolean(replay)}
                  allPinned={
                    checkedResources.length > 0 && checkedResources.every(item => config.pinned.includes(item.id))
                  }
                  allWatched={
                    checkedTopics.length > 0 && checkedTopics.every(item => config.watched.includes(item.name))
                  }
                  onWatch={() => watchMany(checkedTopics.map(item => item.name))}
                  onRecord={() => {
                    const [first] = checkedTopics;
                    if (first)
                      onOpen({
                        panel: 'recordReplay',
                        topic: first.name,
                        topics: checkedTopics.map(item => item.name),
                        messageType: first.types[0] ?? '',
                      });
                  }}
                  onRules={() => addRules(checkedTopics.map(item => item.name))}
                  onPin={() => {
                    const ids = checkedResources.map(item => item.id);
                    const allPinned = ids.every(id => config.pinned.includes(id));
                    change({
                      pinned: allPinned
                        ? config.pinned.filter(id => !ids.includes(id))
                        : [...config.pinned, ...ids.filter(id => !config.pinned.includes(id))],
                    });
                  }}
                  onCopy={() => copy(checkedResources.map(item => item.name).join('\n'))}
                  onClear={() => setChecked(new Set())}
                />
              }
            />
          )}
          {inspector}
        </div>
      )}
      <footer className="de-footer">
        <span>
          {replay
            ? 'Bag time · read-only'
            : `${config.watched.length} watched · ${snapshot.updatedAt ? `Updated ${Math.max(0, Math.floor((Date.now() - snapshot.updatedAt) / 1000))}s ago` : 'Awaiting discovery'}`}
        </span>
        <span>
          {!active
            ? 'Inactive'
            : snapshot.mode === 'host'
              ? 'Rates observed on host'
              : snapshot.mode === 'browser'
                ? 'Preview rates ≠ publisher rates'
                : 'Topology: not recorded'}
        </span>
      </footer>
      {notice && (
        <div className="de-toast" role="status">
          {notice}
        </div>
      )}
    </section>
  );
}
