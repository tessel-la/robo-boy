import type { ExplorerConfig, InspectionSnapshot, Resource, Rule, SchemaField } from './types';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown, limit = 32) =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length < 600))].slice(
        0,
        limit
      )
    : [];
const width = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, value)))
    : fallback;
export const COLUMN_MIN = 44;
export const COLUMN_MAX = 240;
export function sanitizeExplorerConfig(value: unknown): ExplorerConfig {
  const input = object(value);
  const positions: ExplorerConfig['positions'] = {};
  for (const [key, value] of Object.entries(object(input.positions)).slice(0, 500)) {
    const point = object(value);
    if (
      typeof point.x === 'number' &&
      Number.isFinite(point.x) &&
      typeof point.y === 'number' &&
      Number.isFinite(point.y)
    )
      positions[key] = { x: point.x, y: point.y };
  }
  const rules: Rule[] = [];
  for (const candidate of Array.isArray(input.rules) ? input.rules.slice(0, 32) : []) {
    const rule = object(candidate);
    if (typeof rule.topic !== 'string' || !rule.topic.startsWith('/')) continue;
    const next: Rule = { topic: rule.topic };
    for (const key of ['minHz', 'maxHz', 'silenceSec', 'minPublishers', 'minSubscribers'] as const) {
      if (typeof rule[key] === 'number' && Number.isFinite(rule[key]) && rule[key] >= 0)
        next[key] = Math.min(rule[key] as number, 100000);
    }
    rules.push(next);
  }
  return {
    version: 1,
    view: input.view === 'graph' || input.view === 'health' ? input.view : 'resources',
    kind: ['topic', 'service', 'action', 'node'].includes(String(input.kind))
      ? (input.kind as ExplorerConfig['kind'])
      : 'topic',
    query: typeof input.query === 'string' ? input.query.slice(0, 300) : '',
    selected: typeof input.selected === 'string' ? input.selected.slice(0, 600) : '',
    watched: strings(input.watched).filter(name => name.startsWith('/')),
    pinned: strings(input.pinned, 100),
    showHidden: input.showHidden === true,
    source: input.source === 'live' ? 'live' : 'follow',
    rules,
    // 'publishers' and 'count' are earlier names of the providers column.
    sort:
      input.sort === 'rate' || input.sort === 'consumers'
        ? input.sort
        : ['providers', 'count', 'publishers'].includes(String(input.sort))
          ? 'providers'
          : 'name',
    sortDir: input.sortDir === 'desc' ? 'desc' : 'asc',
    columns: {
      providers: width(object(input.columns).providers, 56),
      consumers: width(object(input.columns).consumers, 56),
      rate: width(object(input.columns).rate, 76),
    },
    diagnosticTopic:
      typeof input.diagnosticTopic === 'string' && input.diagnosticTopic.startsWith('/')
        ? input.diagnosticTopic
        : '/diagnostics',
    staleSec:
      typeof input.staleSec === 'number' && Number.isFinite(input.staleSec)
        ? Math.max(1, Math.min(3600, input.staleSec))
        : 10,
    positions,
  };
}

/** Bounded traversal; never stringify a full image/cloud or enumerate every array entry. */
export function boundedPreview(input: unknown, maxNodes = 500, maxChars = 24000) {
  let nodes = 0,
    chars = 0,
    truncated = false;
  const visit = (value: unknown, depth: number): unknown => {
    if (++nodes > maxNodes || chars > maxChars || depth > 8) {
      truncated = true;
      return '…';
    }
    if (typeof value === 'string') {
      chars += Math.min(value.length, 1024);
      if (value.length > 1024) truncated = true;
      return value.length > 1024 ? value.slice(0, 1024) + '…' : value;
    }
    if (typeof value === 'bigint') return value.toString();
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const array = value as unknown as ArrayLike<unknown>;
      const length = array.length ?? 0;
      const result = Array.from({ length: Math.min(length, 24) }, (_, index) => visit(array[index], depth + 1));
      if (length > 24) {
        truncated = true;
        result.push(`… ${length - 24} more items (${length} total)`);
      }
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    let count = 0;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (++count > 100 || nodes >= maxNodes || chars > maxChars) {
        truncated = true;
        result['…'] = 'More fields omitted';
        break;
      }
      chars += key.length;
      result[key] = visit((value as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  };
  return { value: visit(input, 0), truncated };
}

/** Robo-Boy's own and bridge nodes: they subscribe to much of the graph, which hides the robot's structure. */
export const isInfrastructureNode = (name: string) =>
  /^\/(rosbridge_websocket|rosapi|rosapi_params|roboboy_[^/]*|robo_boy_[^/]*)$/.test(name) ||
  name.split('/').some(part => part.startsWith('_'));
/** Services every ROS 2 node offers for its parameters and type descriptions. */
const NODE_BUILTIN_SERVICES =
  /\/(describe_parameters|get_parameter_types|get_parameters|list_parameters|set_parameters|set_parameters_atomically|get_type_description)$/;
export const isInfrastructure = (resource: Resource) =>
  resource.name.split('/').some(part => part.startsWith('_')) ||
  resource.name.startsWith('/roboboy') ||
  ['/rosout', '/parameter_events'].includes(resource.name) ||
  (resource.kind === 'service' && NODE_BUILTIN_SERVICES.test(resource.name)) ||
  (resource.kind === 'node' && isInfrastructureNode(resource.name));
export const numberLabel = (number: number | null | undefined, suffix = '') =>
  number == null || !Number.isFinite(number)
    ? '—'
    : `${number.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;
export const ageLabel = (seconds: number | null | undefined) =>
  seconds == null ? '—' : seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${numberLabel(seconds)} s`;
export const bytesLabel = (size: number | null | undefined) =>
  size == null
    ? '—'
    : size >= 1048576
      ? `${numberLabel(size / 1048576)} MiB/s`
      : size >= 1024
        ? `${numberLabel(size / 1024)} KiB/s`
        : `${numberLabel(size)} B/s`;

export function ruleIssues(rule: Rule, snapshot: InspectionSnapshot): string[] {
  const resource = snapshot.resources.find(item => item.kind === 'topic' && item.name === rule.topic);
  const metric = snapshot.metrics[rule.topic];
  const issues: string[] = [];
  if (rule.minPublishers != null && resource?.publishers != null && resource.publishers < rule.minPublishers)
    issues.push(`Publishers ${resource.publishers}; expected at least ${rule.minPublishers}`);
  if (rule.minSubscribers != null && resource?.subscribers != null && resource.subscribers < rule.minSubscribers)
    issues.push(`Subscribers ${resource.subscribers}; expected at least ${rule.minSubscribers}`);
  if (!metric || metric.unavailable) return issues;
  // Silence is judged against how long this client has actually been watching, so a topic that
  // never delivered is reported once the timeout has elapsed, even past the 10 s rate window.
  const silent = metric.age ?? (metric.observed != null && metric.count === 0 ? metric.observed : null);
  if (rule.silenceSec != null && silent != null && silent > rule.silenceSec)
    issues.push(
      metric.age == null
        ? `No message since watching began (${ageLabel(silent)})`
        : `No message for ${ageLabel(silent)}`
    );
  if (metric.warming) return issues;
  if (metric.rate != null && rule.minHz != null && metric.rate < rule.minHz)
    issues.push(`Rate ${numberLabel(metric.rate)} Hz; expected ≥ ${rule.minHz}`);
  // A throttled source cannot prove a rate above its ceiling.
  const capped = metric.ceiling != null && metric.rate != null && metric.rate >= metric.ceiling * 0.9;
  if (metric.rate != null && rule.maxHz != null && metric.rate > rule.maxHz && !capped)
    issues.push(`Rate ${numberLabel(metric.rate)} Hz; expected ≤ ${rule.maxHz}`);
  return issues;
}

export interface RuleState {
  /** Issues currently reported; empty while healthy or still inside the grace period. */
  issues: string[];
  /** When the reported state last changed (ms, the snapshot clock). */
  since: number;
}

/**
 * Adds a grace period in both directions: a violation must persist for `graceMs` before it is
 * reported, and must stay clear for `graceMs` before it is withdrawn. One late sample therefore
 * does not make a rule alternate between healthy and unhealthy.
 */
export class RuleMonitor {
  private states = new Map<string, RuleState & { pending?: number; candidate: string[] }>();
  constructor(private graceMs = 3000) {}

  evaluate(
    rules: readonly Rule[],
    snapshot: InspectionSnapshot,
    now: number
  ): { states: Map<string, RuleState>; changes: Array<{ topic: string; issues: string[] }> } {
    const changes: Array<{ topic: string; issues: string[] }> = [];
    const wanted = new Set(rules.map(rule => rule.topic));
    for (const topic of this.states.keys()) if (!wanted.has(topic)) this.states.delete(topic);
    for (const rule of rules) {
      const current = ruleIssues(rule, snapshot);
      const state = this.states.get(rule.topic) ?? { issues: [], since: now, candidate: [] };
      const failing = current.length > 0;
      const reported = state.issues.length > 0;
      if (failing === reported) {
        state.pending = undefined;
        if (failing) state.issues = current; // Keep the evidence text current while violated.
      } else {
        if (state.pending === undefined || state.candidate.length > 0 !== failing) state.pending = now;
        if (now - state.pending >= this.graceMs) {
          state.issues = current;
          state.since = now;
          state.pending = undefined;
          changes.push({ topic: rule.topic, issues: current });
        }
      }
      state.candidate = current;
      this.states.set(rule.topic, state);
    }
    return {
      states: new Map([...this.states].map(([topic, { issues, since }]) => [topic, { issues, since }])),
      changes,
    };
  }
}

/** Nested schema from the companion, bounded in depth and total fields whatever the payload says. */
function decodeSchemaFields(input: unknown, depth: number, budget: { fields: number }): SchemaField[] {
  if (!Array.isArray(input) || depth > 6) return [];
  const result: SchemaField[] = [];
  for (const candidate of input) {
    if (budget.fields-- <= 0) break;
    const value = object(candidate);
    if (typeof value.name !== 'string' || typeof value.type !== 'string') continue;
    const field: SchemaField = { name: value.name.slice(0, 200), type: value.type.slice(0, 300) };
    if (Array.isArray(value.fields)) field.fields = decodeSchemaFields(value.fields, depth + 1, budget);
    if (typeof value.unresolved === 'string') field.unresolved = value.unresolved.slice(0, 300);
    result.push(field);
  }
  return result;
}

export function decodeResources(input: unknown): Resource[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 2000).flatMap(candidate => {
    const value = object(candidate);
    if (
      !['topic', 'service', 'action', 'node'].includes(String(value.kind)) ||
      typeof value.name !== 'string' ||
      !value.name.startsWith('/')
    )
      return [];
    const resource: Resource = {
      id: `${value.kind}:${value.name}`,
      kind: value.kind as Resource['kind'],
      name: value.name,
      types: strings(value.types, 20),
      providers: strings(value.providers, 500),
      consumers: strings(value.consumers, 500),
    };
    for (const key of ['publishers', 'subscribers', 'servers', 'clients', 'instances'] as const)
      if (typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) resource[key] = value[key];
    if (value.countKind === 'nodes' || value.countKind === 'endpoints') resource.countKind = value.countKind;
    if (typeof value.error === 'string') resource.error = value.error;
    if (Array.isArray(value.endpoints))
      resource.endpoints = value.endpoints
        .slice(0, 512)
        .filter(
          endpoint =>
            endpoint &&
            typeof endpoint.node === 'string' &&
            typeof endpoint.role === 'string' &&
            endpoint.qos &&
            typeof endpoint.qos === 'object'
        );
    if (Array.isArray(value.compatibility))
      resource.compatibility = value.compatibility
        .slice(0, 64)
        .filter(issue => issue && typeof issue.reason === 'string');
    if (value.schemas && typeof value.schemas === 'object') {
      const budget = { fields: 800 };
      resource.schemas = Object.fromEntries(
        Object.entries(object(value.schemas))
          .slice(0, 8)
          .map(([part, fields]) => [part, decodeSchemaFields(fields, 0, budget)])
      );
    }
    if (value.constants && typeof value.constants === 'object')
      resource.constants = Object.fromEntries(
        Object.entries(object(value.constants))
          .slice(0, 8)
          .map(([part, items]) => [
            part,
            (Array.isArray(items) ? items : [])
              .slice(0, 100)
              .map(object)
              .filter(
                item => typeof item.name === 'string' && ['string', 'number', 'boolean'].includes(typeof item.value)
              )
              .map(item => ({ name: String(item.name).slice(0, 200), value: item.value as string | number | boolean })),
          ])
      );
    return [resource];
  });
}
