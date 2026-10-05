import ROSLIB, { type Ros, type Topic } from 'roslib';
import { runSerializedRosapi } from '../../utils/rosapiQueue';
import { boundedPreview, decodeResources } from './model';
import type { ActionGoal, Diagnostic, InspectionDemand, InspectionSnapshot, Metric, Resource } from './types';
import type { BagInfo } from '../recordReplay/types';
import { createUuid } from '../../utils/uuid';

const PREFIX = '/roboboy/inspection';
const PROBE_LIMIT = 32;
/** Browser previews are throttled by rosbridge to one message per 100 ms. */
const BROWSER_THROTTLE_MS = 100;
const sessions = new WeakMap<Ros, InspectionSession>();
/** Older than this, a companion graph is not known to be current (it rebuilds every ~2 s). */
const CURRENT_GRAPH_AGE_S = 3;
export const emptySnapshot = (): InspectionSnapshot => ({
  resources: [],
  metrics: {},
  previews: {},
  trends: {},
  diagnostics: [],
  logs: [],
  events: [],
  mode: 'browser',
  online: false,
  loading: false,
  updatedAt: 0,
  current: false,
  now: Date.now(),
  errors: [],
  truncated: false,
  refused: [],
  goals: {},
});
const hex = (value: unknown): string => {
  if (typeof value === 'string') {
    // rosbridge sends uint8[] as base64.
    try {
      return [...atob(value)].map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    } catch {
      return value.slice(0, 64);
    }
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value))
    return Array.from(value as ArrayLike<number>, byte => Number(byte).toString(16).padStart(2, '0')).join('');
  return '';
};
export function getInspectionSession(ros: Ros): InspectionSession {
  let session = sessions.get(ros);
  if (!session) {
    session = new InspectionSession(ros);
    sessions.set(ros, session);
  }
  return session;
}
export class InspectionSession {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private demands = new Map<string, InspectionDemand>();
  private topics = new Map<string, Topic>();
  private control?: Topic;
  private transports: Topic[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private client = '';
  private lastHost = 0;
  private lastLease = 0;
  private lastDiscovery = -Infinity;
  private discoveryPending = false;
  private diagnosticMap = new Map<string, Diagnostic>();
  private fallbackTimes = new Map<string, number[]>();
  /** Last browser arrival per topic; unlike `fallbackTimes` it is not trimmed to the rate window. */
  private lastArrival = new Map<string, number>();
  private goalMap = new Map<string, Map<string, ActionGoal>>();
  private diagnosticTopics = new Set<string>();
  private graphRevision = -1;
  /** What the companion's heartbeat last reported: its graph revision and that graph's age. */
  private hostGraphRevision = -1;
  private hostGraphAge = Infinity;
  private lastRefreshRequest = -Infinity;
  private previewTimes = new Map<string, number>();
  private watchStarted = new Map<string, number>();
  private lastTick = -Infinity;
  private sequence = 0;
  private replay?: { info: BagInfo; clock: () => number };
  private abort?: AbortController;
  private dirty = false;
  private now = () => (this.replay ? this.replay.clock() : Date.now());
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(private ros: Ros) {}

  acquire(id: string, demand: InspectionDemand, replay?: { info: BagInfo; clock: () => number }) {
    this.demands.set(id, demand);
    if (this.demands.size === 1) {
      this.replay = replay;
      this.start();
    }
    this.reconcile();
    return () => {
      this.demands.delete(id);
      if (this.demands.size === 0) this.stop();
      else this.reconcile();
    };
  }
  update(id: string, demand: InspectionDemand) {
    if (this.demands.has(id)) {
      this.demands.set(id, demand);
      this.reconcile();
    }
  }
  private set(patch: Partial<InspectionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.dirty = true;
  }
  private notify() {
    if (this.dirty) {
      this.dirty = false;
      this.listeners.forEach(listener => listener());
    }
  }
  /** Adds an event to the shared history, for example a rule a panel evaluated changing state. */
  recordEvent(label: string, level = 0) {
    this.addEvent(label, level);
    this.notify();
  }
  private addEvent(label: string, level = 0) {
    this.set({
      events: [...this.snapshot.events.slice(-199), { id: ++this.sequence, time: this.now(), label, level }],
    });
  }
  private topic(name: string, type: string, callback: (message: Record<string, unknown>) => void, throttle = 0) {
    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name,
      messageType: type,
      queue_length: 1,
      throttle_rate: throttle,
      reconnect_on_close: false,
    });
    // ROSLIB 1.x's no-reconnect path copies an unbound ROS method.
    if (typeof topic.callForSubscribeAndAdvertise === 'function')
      topic.callForSubscribeAndAdvertise = topic.callForSubscribeAndAdvertise.bind(this.ros);
    const token = this.generation;
    topic.subscribe(message => {
      if (token === this.generation && this.demands.size) callback(message);
    });
    return topic;
  }
  private start() {
    ++this.generation;
    this.client = createUuid();
    this.abort = new AbortController();
    this.set({ ...emptySnapshot(), mode: this.replay ? 'recorded' : 'browser', loading: true });
    this.lastHost = 0;
    this.lastLease = 0;
    this.lastDiscovery = -Infinity;
    this.graphRevision = -1;
    this.hostGraphRevision = -1;
    this.hostGraphAge = Infinity;
    this.lastRefreshRequest = -Infinity;
    if (this.replay) {
      const info = this.replay.info;
      this.set({
        resources: info.topics.map(topic => ({
          id: `topic:${topic.name}`,
          kind: 'topic',
          name: topic.name,
          types: [topic.type],
          providers: [],
          consumers: [],
          recordedCount: topic.count,
          error: topic.error,
          definition: topic.definition,
        })),
        loading: false,
        updatedAt: Date.now(),
      });
    } else {
      this.control = new ROSLIB.Topic({
        ros: this.ros,
        name: `${PREFIX}/request`,
        messageType: 'std_msgs/msg/String',
        reconnect_on_close: false,
      });
      if (typeof this.control.callForSubscribeAndAdvertise === 'function')
        this.control.callForSubscribeAndAdvertise = this.control.callForSubscribeAndAdvertise.bind(this.ros);
      this.transports = [
        this.topic(`${PREFIX}/graph`, 'std_msgs/msg/String', message => this.graph(message)),
        this.topic(`${PREFIX}/metrics`, 'std_msgs/msg/String', message => this.metrics(message)),
      ];
    }
    this.timer = setInterval(() => this.tick(), 100);
    this.notify();
  }
  private stop() {
    this.sendLease(true);
    ++this.generation;
    this.abort?.abort();
    clearInterval(this.timer);
    this.topics.forEach(topic => topic.unsubscribe());
    this.topics.clear();
    this.transports.forEach(topic => topic.unsubscribe());
    this.transports = [];
    this.control?.unadvertise();
    this.control = undefined;
    this.fallbackTimes.clear();
    this.lastArrival.clear();
    this.previewTimes.clear();
    this.diagnosticMap.clear();
    this.goalMap.clear();
    this.watchStarted.clear();
    this.lastTick = -Infinity;
    this.discoveryPending = false;
    this.set(emptySnapshot());
    this.notify();
  }
  private parse(message: Record<string, unknown>): Record<string, unknown> | undefined {
    if (typeof message.data !== 'string' || message.data.length > 8 * 1024 * 1024) return;
    try {
      const value = JSON.parse(message.data);
      return value?.version === 1 ? value : undefined;
    } catch {
      return;
    }
  }
  private graph(message: Record<string, unknown>) {
    const value = this.parse(message);
    if (!value || !Array.isArray(value.resources)) return;
    const wasOnline = this.snapshot.online;
    this.lastHost = performance.now();
    if (typeof value.revision === 'number') this.graphRevision = value.revision;
    const resources = decodeResources(value.resources);
    if (this.snapshot.updatedAt && this.snapshot.mode === 'host') {
      const previous = new Set(this.snapshot.resources.map(item => item.id));
      const current = new Set(resources.map(item => item.id));
      const changes = [
        ...resources.filter(item => !previous.has(item.id)).map(item => `Discovered ${item.kind} ${item.name}`),
        ...this.snapshot.resources
          .filter(item => !current.has(item.id))
          .map(item => `No longer discovered: ${item.name}`),
      ];
      changes.slice(0, 10).forEach(label => this.addEvent(label));
      if (changes.length > 10) this.addEvent(`${changes.length - 10} more graph changes`);
    }
    this.set({
      resources,
      mode: 'host',
      online: true,
      loading: false,
      updatedAt: typeof value.age === 'number' ? Date.now() - value.age * 1000 : 0,
      current: this.graphIsCurrent(true),
      truncated: value.truncated === true,
      errors: Array.isArray(value.errors)
        ? value.errors.filter((v): v is string => typeof v === 'string').slice(0, 10)
        : [],
    });
    if (!wasOnline) {
      this.fallbackTimes.clear();
      this.set({ metrics: {}, trends: {} });
    }
    this.reconcile();
  }
  private metrics(message: Record<string, unknown>) {
    const value = this.parse(message);
    if (!value || !value.metrics || typeof value.metrics !== 'object') return;
    // Metrics arrive every 500 ms and double as the companion heartbeat: the graph itself is only
    // republished when discovery finds a change.
    this.lastHost = performance.now();
    if (typeof value.graphRevision === 'number') this.hostGraphRevision = value.graphRevision;
    if (typeof value.graphAge === 'number') this.hostGraphAge = value.graphAge;
    if (typeof value.graphAge === 'number' && this.snapshot.online)
      this.set({ updatedAt: Date.now() - value.graphAge * 1000 });
    if (this.snapshot.current !== this.graphIsCurrent(this.snapshot.online))
      this.set({ current: this.graphIsCurrent(this.snapshot.online) });
    if (
      typeof value.graphRevision === 'number' &&
      value.graphRevision !== this.graphRevision &&
      performance.now() - this.lastRefreshRequest > 3000
    ) {
      // A graph published before this client subscribed was missed; ask for it again.
      this.lastRefreshRequest = performance.now();
      this.sendLease(false, true);
    }
    const now = performance.now();
    const metrics: Record<string, Metric> = {};
    const trends: InspectionSnapshot['trends'] = {};
    const refused = Array.isArray(value.refused)
      ? value.refused.filter((topic): topic is string => typeof topic === 'string').slice(0, 256)
      : [];
    const probeErrors =
      value.errors && typeof value.errors === 'object' ? (value.errors as Record<string, unknown>) : {};
    const reported = value.metrics as Record<string, unknown>;
    for (const topic of this.demandsSummary().watch) {
      const observed = (now - (this.watchStarted.get(topic) ?? now)) / 1000;
      const raw = Object.prototype.hasOwnProperty.call(reported, topic) ? reported[topic] : undefined;
      const candidate = raw && typeof raw === 'object' ? (raw as Metric) : undefined;
      if (
        !candidate ||
        candidate.source !== 'host' ||
        typeof candidate.count !== 'number' ||
        typeof candidate.window !== 'number'
      ) {
        const reason = refused.includes(topic)
          ? `Not measured: the shared ${PROBE_LIMIT}-topic probe budget is full`
          : probeErrors[topic] != null
            ? `Not measured: ${String(probeErrors[topic]).slice(0, 300)}`
            : 'Starting probe…';
        metrics[topic] = {
          rate: null,
          bytesPerSec: null,
          age: null,
          count: 0,
          window: 0,
          source: 'host',
          unavailable: reason,
          observed,
        };
        continue;
      }
      const metric: Metric = { ...candidate, observed };
      for (const key of [
        'rate',
        'bytesPerSec',
        'age',
        'intervalMean',
        'intervalMin',
        'intervalMax',
        'jitter',
        'meanBytes',
        'maxBytes',
      ] as const) {
        if (metric[key] != null && (typeof metric[key] !== 'number' || !Number.isFinite(metric[key])))
          Object.assign(metric, { [key]: null });
      }
      metrics[topic] = metric;
      trends[topic] = [
        ...(this.snapshot.trends[topic] ?? []).slice(-119),
        { time: Date.now(), rate: metric.rate ?? 0, bytes: metric.bytesPerSec ?? 0 },
      ];
    }
    const errors = Object.entries(probeErrors)
      .slice(0, 32)
      .map(([name, error]) => `${name}: ${String(error)}`);
    if (refused.length) errors.push(`Probe limit reached: ${refused.join(', ')}`);
    this.set({
      metrics,
      trends,
      refused,
      errors: [
        ...this.snapshot.errors.filter(error => !error.startsWith('Probe:')),
        ...errors.map(error => `Probe: ${error}`),
      ].slice(-40),
    });
  }
  private demandsSummary() {
    const watch = new Set<string>(),
      selected = new Set<string>(),
      health = new Set<string>();
    for (const demand of this.demands.values()) {
      demand.watch.forEach(topic => watch.add(topic));
      if (demand.selected) selected.add(demand.selected);
      if (demand.health) {
        health.add(demand.diagnosticTopic);
        health.add('/rosout');
      }
    }
    return { watch: [...watch], selected: [...selected], health: [...health] };
  }
  private sendLease(release = false, refresh = false) {
    const demand = this.demandsSummary();
    this.control?.publish(
      new ROSLIB.Message({
        data: JSON.stringify({
          version: 1,
          client: this.client,
          watch: demand.watch,
          details: demand.selected,
          release,
          refresh,
        }),
      })
    );
    this.lastLease = performance.now();
  }
  private reconcile() {
    const demand = this.demandsSummary();
    for (const name of this.watchStarted.keys()) if (!demand.watch.includes(name)) this.watchStarted.delete(name);
    for (const name of demand.watch.slice(0, 32))
      if (!this.watchStarted.has(name)) this.watchStarted.set(name, performance.now());
    const wanted = new Map<string, string>();
    for (const id of demand.selected) {
      const resource = this.snapshot.resources.find(item => item.id === id);
      if (resource?.kind === 'topic' && resource.types.length === 1) wanted.set(resource.name, resource.types[0]);
      if (resource?.kind === 'action' && resource.types.length === 1) {
        wanted.set(`${resource.name}/_action/status`, 'action_msgs/msg/GoalStatusArray');
        wanted.set(`${resource.name}/_action/feedback`, `${resource.types[0]}_FeedbackMessage`);
      }
    }
    if (!this.replay && !this.snapshot.online)
      for (const name of demand.watch.slice(0, 32)) {
        const resource = this.snapshot.resources.find(item => item.kind === 'topic' && item.name === name);
        if (resource?.types.length === 1) wanted.set(name, resource.types[0]);
      }
    this.diagnosticTopics = new Set(demand.health.filter(name => name !== '/rosout'));
    for (const name of demand.health)
      wanted.set(name, name === '/rosout' ? 'rcl_interfaces/msg/Log' : 'diagnostic_msgs/msg/DiagnosticArray');
    for (const [name, topic] of this.topics)
      if (!wanted.has(name) || topic.messageType !== wanted.get(name)) {
        topic.unsubscribe();
        this.topics.delete(name);
        this.fallbackTimes.delete(name);
        this.lastArrival.delete(name);
        this.previewTimes.delete(name);
        this.goalMap.delete(name);
      }
    for (const [name, type] of [...wanted].slice(0, 48))
      if (!this.topics.has(name))
        this.topics.set(
          name,
          this.topic(name, type, message => this.receive(name, message), BROWSER_THROTTLE_MS)
        );
    const previews = Object.fromEntries(Object.entries(this.snapshot.previews).filter(([name]) => wanted.has(name)));
    if (Object.keys(previews).length !== Object.keys(this.snapshot.previews).length) this.set({ previews });
    // A topic nobody watches any more loses its measurement at once, not at the next metrics message.
    const watching = new Set(demand.watch);
    const keep = <T>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([name]) => watching.has(name)));
    if (
      Object.keys(this.snapshot.metrics).some(name => !watching.has(name)) ||
      Object.keys(this.snapshot.trends).some(name => !watching.has(name))
    )
      this.set({ metrics: keep(this.snapshot.metrics), trends: keep(this.snapshot.trends) });
    const goals = Object.fromEntries(
      Object.entries(this.snapshot.goals).filter(([name]) => wanted.has(`${name}/_action/status`))
    );
    if (Object.keys(goals).length !== Object.keys(this.snapshot.goals).length) this.set({ goals });
    if (this.control && performance.now() - this.lastLease > 200) this.sendLease();
  }
  private receive(name: string, message: Record<string, unknown>) {
    const now = this.now();
    const monotonic = performance.now();
    const times = this.fallbackTimes.get(name) ?? [];
    times.push(monotonic);
    while (times.length > 200 || (times[0] ?? monotonic) < monotonic - 10000) times.shift();
    this.fallbackTimes.set(name, times);
    this.lastArrival.set(name, monotonic);
    if (name.endsWith('/_action/status') && Array.isArray(message.status_list))
      this.receiveGoals(name, message.status_list, now);
    if (name === '/rosout') {
      const text = String(message.msg ?? '').slice(0, 2000),
        logger = String(message.name ?? '').slice(0, 300);
      const logs = [...this.snapshot.logs];
      const last = logs[logs.length - 1];
      if (last?.message === text && last.name === logger)
        logs[logs.length - 1] = { ...last, repeats: last.repeats + 1, receivedAt: now };
      else
        logs.push({
          id: ++this.sequence,
          name: logger,
          level: Number(message.level) || 20,
          message: text,
          receivedAt: now,
          repeats: 1,
        });
      this.set({ logs: logs.slice(-200) });
    }
    if (this.diagnosticTopics.has(name) && Array.isArray(message.status))
      for (const raw of message.status.slice(0, 200)) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        const id = `${name}:${String(item.name)}:${String(item.hardware_id)}`;
        const previous = this.diagnosticMap.get(id);
        const diagnostic: Diagnostic = {
          id,
          source: name,
          name: String(item.name ?? '').slice(0, 500),
          hardware: String(item.hardware_id ?? '').slice(0, 500),
          level: Number(item.level) || 0,
          message: String(item.message ?? '').slice(0, 2000),
          values: Array.isArray(item.values)
            ? item.values
                .slice(0, 50)
                .filter(pair => pair && typeof pair === 'object')
                .map(pair => ({
                  key: String(pair.key ?? '').slice(0, 500),
                  value: String(pair.value ?? '').slice(0, 1000),
                }))
            : [],
          receivedAt: now,
        };
        if (!previous || previous.level !== diagnostic.level || previous.message !== diagnostic.message)
          this.addEvent(`${diagnostic.name}: ${diagnostic.message}`, diagnostic.level);
        this.diagnosticMap.set(id, diagnostic);
        if (this.diagnosticMap.size > 500) this.diagnosticMap.delete(this.diagnosticMap.keys().next().value!);
        this.set({ diagnostics: [...this.diagnosticMap.values()] });
      }
    if (monotonic - (this.previewTimes.get(name) ?? -Infinity) < 100) return;
    this.previewTimes.set(name, monotonic);
    const preview = boundedPreview(message);
    this.set({
      previews: {
        ...this.snapshot.previews,
        [name]: { ...preview, previous: this.snapshot.previews[name]?.value, receivedAt: now },
      },
    });
  }
  /** Tracks goals and their status transitions from a GoalStatusArray, bounded per action. */
  private receiveGoals(topic: string, list: unknown[], now: number) {
    const action = topic.slice(0, -'/_action/status'.length);
    const goals = this.goalMap.get(topic) ?? new Map<string, ActionGoal>();
    for (const raw of list.slice(0, 100)) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { status?: unknown; goal_info?: { goal_id?: { uuid?: unknown } } };
      const id = hex(item.goal_info?.goal_id?.uuid);
      const status = Number(item.status);
      if (!id || !Number.isInteger(status)) continue;
      const known = goals.get(id);
      if (!known) goals.set(id, { id, status, firstSeen: now, changedAt: now, history: [{ status, time: now }] });
      else if (known.status !== status)
        goals.set(id, {
          ...known,
          status,
          changedAt: now,
          history: [...known.history.slice(-9), { status, time: now }],
        });
    }
    // Keep the 50 most recently changed goals; status retention on the robot may drop older ones.
    const kept = [...goals.values()].sort((a, b) => b.changedAt - a.changedAt).slice(0, 50);
    this.goalMap.set(topic, new Map(kept.map(goal => [goal.id, goal])));
    this.set({ goals: { ...this.snapshot.goals, [action]: kept } });
  }
  private tick() {
    const now = performance.now();
    if (now - this.lastTick < 500) {
      this.notify();
      return;
    }
    this.lastTick = now;
    if (!this.replay) {
      if (now - this.lastLease >= 2000) this.sendLease();
      if (this.snapshot.online && now - this.lastHost > 5000) {
        this.set({ online: false, current: false, mode: 'browser', metrics: {}, trends: {} });
        this.reconcile();
      }
      if (!this.snapshot.online && now - this.lastDiscovery > 15000) void this.discover();
      if (!this.snapshot.online) {
        const metrics: Record<string, Metric> = {};
        for (const name of this.demandsSummary().watch.slice(0, PROBE_LIMIT)) {
          const observed = (now - (this.watchStarted.get(name) ?? now)) / 1000;
          // Without a subscription there is nothing to count: unknown, never a measured zero.
          if (!this.topics.has(name)) {
            const resource = this.snapshot.resources.find(item => item.kind === 'topic' && item.name === name);
            const unavailable = !resource
              ? 'Not measured: topic not discovered'
              : resource.types.length !== 1
                ? 'Not measured: the topic has no single message type'
                : 'Not measured in the browser';
            metrics[name] = {
              rate: null,
              bytesPerSec: null,
              age: null,
              count: 0,
              window: 0,
              source: 'browser',
              unavailable,
              observed,
            };
            continue;
          }
          const times = this.fallbackTimes.get(name) ?? [];
          const recent = times.filter(time => time > now - 10000);
          const window = Math.min(10, observed);
          const last = this.lastArrival.get(name);
          metrics[name] = {
            rate: window >= 1 ? recent.length / window : null,
            bytesPerSec: null,
            age: last == null ? null : (now - last) / 1000,
            count: recent.length,
            window,
            source: 'browser',
            warming: window < 10,
            observed,
            ceiling: 1000 / BROWSER_THROTTLE_MS,
          };
        }
        this.set({ metrics });
      }
    }
    this.set({ now: this.now() });
    this.notify();
  }
  /**
   * The companion rebuilds its graph every ~2 s while anyone holds a lease, so a heartbeat for the
   * revision held, about a graph younger than a few seconds, means nothing newer exists.
   */
  private graphIsCurrent(online: boolean): boolean {
    return online && this.graphRevision >= 0 && this.hostGraphRevision === this.graphRevision
      && this.hostGraphAge <= CURRENT_GRAPH_AGE_S;
  }
  refresh = () => {
    this.sendLease(false, true);
    this.lastDiscovery = -Infinity;
    if (!this.snapshot.online && !this.replay) void this.discover();
  };
  private call(service: string, type: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return runSerializedRosapi(
      this.ros,
      () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`${service} timed out`)), 6000);
          const client = new ROSLIB.Service({ ros: this.ros, name: service, serviceType: `rosapi_msgs/srv/${type}` });
          client.callService(
            new ROSLIB.ServiceRequest(args),
            response => {
              clearTimeout(timer);
              resolve(response);
            },
            error => {
              clearTimeout(timer);
              reject(error);
            }
          );
        }),
      this.abort?.signal
    );
  }
  private async discover() {
    if (this.discoveryPending || this.replay) return;
    this.discoveryPending = true;
    this.lastDiscovery = performance.now();
    const token = this.generation;
    try {
      const response = await this.call('/rosapi/topics', 'Topics');
      const names = Array.isArray(response.topics) ? response.topics : [];
      const types = Array.isArray(response.types) ? response.types : [];
      const resources: Resource[] = names.slice(0, 2000).map((name, index) => ({
        id: `topic:${name}`,
        kind: 'topic',
        name: String(name),
        // rosapi reports '' when a topic has no single type; that is unknown, not a type to subscribe with.
        types: types[index] ? [String(types[index])] : [],
        providers: [],
        consumers: [],
      }));
      for (const topic of [...resources])
        if (topic.name.endsWith('/_action/feedback')) {
          const name = topic.name.slice(0, -'/_action/feedback'.length);
          resources.push({
            id: `action:${name}`,
            kind: 'action',
            name,
            types: topic.types.map(type => type.replace(/_FeedbackMessage$/, '')),
            providers: [],
            consumers: [],
          });
        }
      if (token === this.generation && !this.snapshot.online) {
        this.set({ resources, loading: false, updatedAt: Date.now(), truncated: names.length > 2000 });
        this.reconcile();
      }
      for (const [service, type, field, kind] of [
        ['services', 'Services', 'services', 'service'],
        ['nodes', 'Nodes', 'nodes', 'node'],
      ] as const) {
        if (token !== this.generation || this.snapshot.online) break;
        const result = await this.call(`/rosapi/${service}`, type);
        if (token !== this.generation || this.snapshot.online) break;
        const entries = Array.isArray(result[field]) ? (result[field] as string[]) : [];
        const extra: Resource[] = entries
          .slice(0, 500)
          .map(name => ({ id: `${kind}:${name}`, kind, name, types: [], providers: [], consumers: [] }));
        this.set({ resources: [...this.snapshot.resources.filter(resource => resource.kind !== kind), ...extra] });
      }
    } catch (error) {
      if (token === this.generation && !this.snapshot.online)
        this.set({ loading: false, errors: [error instanceof Error ? error.message : String(error)] });
    } finally {
      if (token === this.generation) this.discoveryPending = false;
    }
  }
}
