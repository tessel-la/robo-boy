import type { AssistantCapability } from '../assistant/capabilities';
import { boundedPreview, isInfrastructure, ruleIssues, type RuleState } from './model';
import type { ExplorerConfig, InspectionSnapshot, Resource, ResourceKind, Rule } from './types';

/*
 * The Data Explorer as the AI assistant sees it. `describeDataExplorer` turns what the panel holds
 * into a bounded summary for the prompt, and `applyExplorerSettings` turns the assistant's request
 * into a configuration change, with an outcome per request in the user's terms. Both are pure; the
 * panel registers them as its assistant bridge.
 */

export const WATCH_LIMIT = 32;
export const RULE_LIMIT = 32;
const TOPIC_LIMIT = 200;
const RESOURCE_LIMIT = 150;
const DIAGNOSTIC_LIMIT = 40;
const LOG_LIMIT = 25;
const KEPT_LOGS = 200;
const LOG_LEVELS: Record<string, number> = { debug: 10, info: 20, warning: 30, warn: 30, error: 40, fatal: 50 };

/** A filter over the kept /rosout entries, asked for by the assistant and answered on its next turn. */
export interface LogQuery {
  level?: number;
  node?: string;
  text?: string;
  limit: number;
}

const levelName = (level: number) =>
  level >= 50 ? 'fatal' : level >= 40 ? 'error' : level >= 30 ? 'warning' : level >= 20 ? 'info' : 'debug';
const EVENT_LIMIT = 15;
const ENDPOINT_LIMIT = 20;
const DETAIL_CHARS = 6000;

export const DATA_EXPLORER_SETTINGS_HELP = [
  'The Data Explorer inspects the ROS graph and keeps the robot\'s health. Its settings report every topic, service, action and node with publisher/subscriber (or server/client) counts, measured rates of watched topics, QoS incompatibilities, diagnostics, recent /rosout logs, events, and health rules with their state; "selectedResource" holds the selected item\'s endpoints, QoS, schema and latest message.',
  'It accepts: "watch":["/topic",...] to start measuring rate, bandwidth and message age on the ROS host (at most 32 watched); "unwatch":["/topic"] or "all";',
  '"addRules":[{"topic":"/t","minHz":9,"maxHz":20,"silenceSec":2,"minPublishers":1,"minSubscribers":1}] to add or update health rules (any subset of thresholds; a rule topic is measured automatically; at most 32 rules); "removeRules":["/t"] or "all";',
  '"select":"/name" (or "service:/name", "action:/name", "node:/name") to inspect one resource, its latest message included on the next turn; "" clears;',
  '"view":"resources"|"graph"|"health"; "kind":"topic"|"service"|"action"|"node"; "query":"text filter"; "showHidden":true|false; "pin"/"unpin":["/name"];',
  '"diagnosticTopic":"/diagnostics_agg"; "staleSec":10; "refresh":true to rediscover the graph; "source":"follow"|"live" while a recording is open.',
  '"logs":{"level":"warning","node":"name part","text":"words","limit":200} lists the /rosout entries kept since the panel opened (the newest 200) that match, in "logs.matching" on the next turn, so ask about them in "followUp"; "logs":true lists them all.',
  "Watching or a rule only observes: nothing is published to the robot's own topics. Counts include observers such as rosbridge and the inspector itself.",
].join(' ');

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const listOf = (value: unknown): string[] | null =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : null;

/** A compact message or schema for the prompt: complete when small, cut short with a marker when not. */
const compact = (value: unknown, limit = DETAIL_CHARS) => {
  const bounded = boundedPreview(value, 300, limit).value;
  const text = JSON.stringify(bounded) ?? '';
  return text.length <= limit ? bounded : `${text.slice(0, limit)}… (truncated)`;
};

export interface ExplorerBridgeInput {
  snapshot: InspectionSnapshot;
  config: ExplorerConfig;
  ruleStates: ReadonlyMap<string, RuleState>;
  /** The name of the recording being inspected, when the panel follows replay. */
  recording?: { name: string; seconds: number | null };
  /** A recording is open but the panel inspects the live robot. */
  liveDuringReplay?: boolean;
  /** The panel is hidden or the tab in the background: measurements pause until it is shown. */
  active: boolean;
  connected: boolean;
  logQuery?: LogQuery;
}

function sourceLabel({ snapshot, recording, connected }: ExplorerBridgeInput) {
  if (recording) return `recording "${recording.name}" (recorded counts and whole-file rates; no live topology)`;
  if (!connected) return 'not connected to ROS';
  return snapshot.online
    ? 'ROS host, measured by the Robo-Boy inspection companion'
    : 'browser only: the inspection companion is unavailable, so endpoint counts, QoS and schemas are unknown and rates are browser preview rates (10 per second at most)';
}

function describeTopic(resource: Resource, input: ExplorerBridgeInput) {
  const { snapshot, config, ruleStates, recording } = input;
  const metric = snapshot.metrics[resource.name];
  const issues = ruleStates.get(resource.name)?.issues ?? [];
  return {
    name: resource.name,
    type: resource.types.join(', ') || undefined,
    ...(recording
      ? {
          recordedMessages: resource.recordedCount,
          averageHz:
            resource.recordedCount != null && recording.seconds
              ? round(resource.recordedCount / recording.seconds)
              : undefined,
        }
      : { publishers: resource.publishers, subscribers: resource.subscribers }),
    watched: config.watched.includes(resource.name) || undefined,
    pinned: config.pinned.includes(resource.id) || undefined,
    ...(metric
      ? metric.unavailable
        ? { notMeasured: metric.unavailable }
        : {
            hz: metric.rate == null ? undefined : round(metric.rate),
            hzIsLowerBound:
              metric.ceiling != null && metric.rate != null && metric.rate >= metric.ceiling * 0.9 ? true : undefined,
            bytesPerSec: metric.bytesPerSec == null ? undefined : Math.round(metric.bytesPerSec),
            lastMessageAgeSec: metric.age == null ? undefined : round(metric.age),
            warmingUp: metric.warming || undefined,
          }
      : {}),
    ruleViolations: issues.length ? issues : undefined,
    qosIncompatible: resource.compatibility?.length ? true : undefined,
  };
}

function describeSelected(resource: Resource, input: ExplorerBridgeInput) {
  const { snapshot } = input;
  const previewTopic = resource.kind === 'action' ? `${resource.name}/_action/status` : resource.name;
  const preview = snapshot.previews[previewTopic];
  const metric = snapshot.metrics[resource.name];
  return {
    kind: resource.kind,
    name: resource.name,
    types: resource.types,
    providers: resource.providers,
    consumers: resource.consumers,
    countKind: resource.countKind,
    instances: resource.instances,
    error: resource.error,
    endpoints: resource.endpoints?.slice(0, ENDPOINT_LIMIT).map(endpoint => ({
      node: endpoint.node,
      role: endpoint.role,
      observer: endpoint.observer || undefined,
      qos: endpoint.qos,
    })),
    qosIncompatibilities: resource.compatibility,
    schema: resource.schemas ? compact(resource.schemas) : undefined,
    constants: resource.constants ? compact(resource.constants, 2000) : undefined,
    definition: resource.definition ? resource.definition.slice(0, 3000) : undefined,
    traffic:
      metric && !metric.unavailable
        ? {
            meanIntervalSec: metric.intervalMean ?? undefined,
            shortestIntervalSec: metric.intervalMin ?? undefined,
            longestIntervalSec: metric.intervalMax ?? undefined,
            jitterSec: metric.jitter ?? undefined,
            meanMessageBytes: metric.meanBytes ?? undefined,
            largestMessageBytes: metric.maxBytes,
            receivedMessages: metric.count,
            source: metric.source,
          }
        : undefined,
    latestMessage: preview
      ? {
          receivedSecondsAgo: round(Math.max(0, snapshot.now - preview.receivedAt) / 1000, 1),
          shortened: preview.truncated || undefined,
          value: compact(preview.value),
        }
      : resource.kind === 'topic' || resource.kind === 'action'
        ? 'No message received yet.'
        : undefined,
    goals:
      resource.kind === 'action'
        ? (snapshot.goals[resource.name] ?? []).slice(0, 10).map(goal => ({
            id: goal.id.slice(0, 8),
            status: goal.status,
            history: goal.history.map(step => step.status),
          }))
        : undefined,
    relatedResources:
      resource.kind === 'node'
        ? snapshot.resources
            .filter(item => item.providers.includes(resource.name) || item.consumers.includes(resource.name))
            .slice(0, 60)
            .map(
              item =>
                `${item.kind} ${item.name} (${item.providers.includes(resource.name) ? 'provides/publishes' : 'uses/subscribes'})`
            )
        : undefined,
  };
}

const describeLog = (log: InspectionSnapshot['logs'][number], now: number) => ({
  node: log.name,
  level: levelName(log.level),
  message: log.message.slice(0, 400),
  repeats: log.repeats > 1 ? log.repeats : undefined,
  secondsAgo: round(Math.max(0, now - log.receivedAt) / 1000, 1),
});

/** The kept /rosout entries matching a query, newest last. */
export function queryLogs(snapshot: InspectionSnapshot, query: LogQuery) {
  const node = query.node?.toLowerCase();
  const text = query.text?.toLowerCase();
  const found = snapshot.logs.filter(
    log =>
      (query.level == null || log.level >= query.level) &&
      (!node || log.name.toLowerCase().includes(node)) &&
      (!text || log.message.toLowerCase().includes(text))
  );
  return {
    filter: {
      level: query.level == null ? undefined : levelName(query.level),
      node: query.node,
      text: query.text,
    },
    found: found.length,
    entries: found.slice(-query.limit).map(log => describeLog(log, snapshot.now)),
  };
}

/** What the Data Explorer shows, bounded for the prompt. */
export function describeDataExplorer(input: ExplorerBridgeInput) {
  const { snapshot, config, ruleStates } = input;
  const followed = new Set([...config.watched, ...config.rules.map(rule => rule.topic)]);
  const visible = (resource: Resource) =>
    config.showHidden ||
    !isInfrastructure(resource) ||
    followed.has(resource.name) ||
    config.pinned.includes(resource.id);
  const ofKind = (kind: ResourceKind) =>
    snapshot.resources.filter(resource => resource.kind === kind && visible(resource));

  const topics = ofKind('topic').sort(
    (a, b) => Number(followed.has(b.name)) - Number(followed.has(a.name)) || a.name.localeCompare(b.name)
  );
  const services = ofKind('service');
  const actions = ofKind('action');
  const nodes = ofKind('node');
  const nodeTopics = new Map<string, { publishes: number; subscribes: number }>();
  for (const resource of snapshot.resources) {
    if (resource.kind !== 'topic') continue;
    for (const node of resource.providers) {
      const entry = nodeTopics.get(node) ?? { publishes: 0, subscribes: 0 };
      entry.publishes += 1;
      nodeTopics.set(node, entry);
    }
    for (const node of resource.consumers) {
      const entry = nodeTopics.get(node) ?? { publishes: 0, subscribes: 0 };
      entry.subscribes += 1;
      nodeTopics.set(node, entry);
    }
  }

  const diagnostics = snapshot.diagnostics.filter(item => item.source === config.diagnosticTopic);
  const stale = (receivedAt: number) => snapshot.now - receivedAt > config.staleSec * 1000;
  const attention = diagnostics.filter(item => item.level > 0 || stale(item.receivedAt));
  const ordered = [...attention, ...diagnostics.filter(item => !attention.includes(item))];
  const selected = snapshot.resources.find(resource => resource.id === config.selected);

  return {
    source: sourceLabel(input),
    liveRobotWhileReplayOpen: input.liveDuringReplay || undefined,
    paused: input.active ? undefined : 'The panel is hidden, so measurements pause until it is on screen again.',
    discovering: snapshot.loading || undefined,
    graphConfirmedCurrent: snapshot.online ? snapshot.current : undefined,
    graphAgeSec: snapshot.updatedAt ? round(Math.max(0, Date.now() - snapshot.updatedAt) / 1000, 1) : undefined,
    graphTruncated: snapshot.truncated || undefined,
    inspectionErrors: snapshot.errors.length ? snapshot.errors : undefined,
    probesRefused: snapshot.refused.length ? snapshot.refused : undefined,
    countMeaning:
      'Topic counts are endpoints (one node with two publishers counts 2). Service counts are endpoints when countKind is "endpoints", else nodes; action counts are participating nodes. Counts include observers (rosbridge, recorder, this inspector).',
    view: config.view,
    kind: config.kind,
    query: config.query || undefined,
    selected: selected ? `${selected.kind}:${selected.name}` : undefined,
    showHidden: config.showHidden,
    watched: config.watched,
    watchLimit: WATCH_LIMIT,
    pinned: config.pinned.length ? config.pinned : undefined,
    topics: topics.slice(0, TOPIC_LIMIT).map(resource => describeTopic(resource, input)),
    services: services.slice(0, RESOURCE_LIMIT).map(resource => ({
      name: resource.name,
      type: resource.types.join(', ') || undefined,
      servers: resource.servers,
      clients: resource.clients,
      countKind: resource.countKind,
    })),
    actions: actions.slice(0, RESOURCE_LIMIT).map(resource => ({
      name: resource.name,
      type: resource.types.join(', ') || undefined,
      servers: resource.servers,
      clients: resource.clients,
    })),
    nodes: nodes.slice(0, RESOURCE_LIMIT).map(resource => ({
      name: resource.name,
      publishesTopics: nodeTopics.get(resource.name)?.publishes ?? 0,
      subscribesTopics: nodeTopics.get(resource.name)?.subscribes ?? 0,
      sharedName: resource.instances && resource.instances > 1 ? resource.instances : undefined,
    })),
    notListed: {
      topics: Math.max(0, topics.length - TOPIC_LIMIT),
      services: Math.max(0, services.length - RESOURCE_LIMIT),
      actions: Math.max(0, actions.length - RESOURCE_LIMIT),
      nodes: Math.max(0, nodes.length - RESOURCE_LIMIT),
      hidden: config.showHidden ? 0 : snapshot.resources.filter(resource => !visible(resource)).length,
    },
    diagnostics: {
      topic: config.diagnosticTopic,
      staleAfterSec: config.staleSec,
      components: diagnostics.length,
      needAttention: attention.length,
      items: ordered.slice(0, DIAGNOSTIC_LIMIT).map(item => ({
        name: item.name,
        hardware: item.hardware || undefined,
        level: ['ok', 'warning', 'error', 'stale'][item.level] ?? item.level,
        updateStale: stale(item.receivedAt) || undefined,
        message: item.message,
        values: item.values.length ? item.values.slice(0, 12) : undefined,
      })),
    },
    logs: {
      kept: snapshot.logs.length,
      warnings: snapshot.logs.filter(log => log.level >= 30 && log.level < 40).length,
      errors: snapshot.logs.filter(log => log.level >= 40).length,
      latest: snapshot.logs.slice(-LOG_LIMIT).map(log => describeLog(log, snapshot.now)),
      matching: input.logQuery ? queryLogs(snapshot, input.logQuery) : undefined,
      keptAtMost: KEPT_LOGS,
    },
    events: snapshot.events.slice(-EVENT_LIMIT).map(event => ({
      label: event.label,
      level: event.level ? ['info', 'warning', 'error'][Math.min(2, event.level)] : undefined,
      secondsAgo: round(Math.max(0, snapshot.now - event.time) / 1000, 1),
    })),
    rules: config.rules.map(rule => {
      const state = ruleStates.get(rule.topic);
      const issues = state?.issues ?? [];
      const pending = ruleIssues(rule, snapshot).length > 0 !== issues.length > 0;
      return {
        ...rule,
        state: issues.length ? 'violated' : snapshot.metrics[rule.topic] ? 'ok' : 'not measured yet',
        issues: issues.length ? issues : undefined,
        changing: pending || undefined,
        sinceSecondsAgo: state ? round(Math.max(0, snapshot.now - state.since) / 1000, 1) : undefined,
      };
    }),
    ruleLimit: RULE_LIMIT,
    selectedResource: selected ? describeSelected(selected, input) : undefined,
  };
}

export interface ExplorerSettingsResult {
  patch: Partial<ExplorerConfig>;
  outcomes: Array<{ ok: boolean; message: string }>;
  refresh: boolean;
  /** Set when the assistant asked for logs: the panel keeps it for the next turn's description. */
  logQuery?: LogQuery;
}

const RULE_KEYS = ['minHz', 'maxHz', 'silenceSec', 'minPublishers', 'minSubscribers'] as const;
const KINDS: ResourceKind[] = ['topic', 'service', 'action', 'node'];
const KNOWN_KEYS = new Set([
  'watch',
  'unwatch',
  'addRules',
  'rules',
  'removeRules',
  'select',
  'view',
  'kind',
  'query',
  'showHidden',
  'pin',
  'unpin',
  'diagnosticTopic',
  'staleSec',
  'refresh',
  'source',
  'logs',
]);

/** Finds a resource by "/name", "kind:/name" or its id, preferring a topic when a name is shared. */
export function findResource(snapshot: InspectionSnapshot, reference: string): Resource | undefined {
  const match = reference.match(/^(topic|service|action|node):(\/.*)$/);
  if (match) return snapshot.resources.find(resource => resource.kind === match[1] && resource.name === match[2]);
  const named = snapshot.resources.filter(resource => resource.name === reference);
  return KINDS.map(kind => named.find(resource => resource.kind === kind)).find(Boolean);
}

/**
 * Applies the assistant's requested settings to a copy of the configuration. Requests are applied
 * in a fixed order and each one reports what happened, including what was refused and why.
 */
export function applyExplorerSettings(
  config: ExplorerConfig,
  settings: Record<string, unknown>,
  snapshot: InspectionSnapshot,
  options: { recording: boolean }
): ExplorerSettingsResult {
  const outcomes: ExplorerSettingsResult['outcomes'] = [];
  const patch: Partial<ExplorerConfig> = {};
  let watched = [...config.watched];
  let rules = [...config.rules];
  let pinned = [...config.pinned];
  const topicNames = new Set(
    snapshot.resources.filter(resource => resource.kind === 'topic').map(resource => resource.name)
  );
  // A panel the assistant just opened is still discovering the graph: a well-formed name is taken
  // on trust then, rather than refused for a topic that has simply not been listed yet.
  const discovering = snapshot.loading || snapshot.resources.length === 0;
  const known = (name: string) => topicNames.has(name) || (discovering && name.startsWith('/'));

  const unwatch = settings.unwatch === 'all' ? [...watched] : listOf(settings.unwatch);
  if (unwatch?.length) {
    const removed = unwatch.filter(name => watched.includes(name));
    watched = watched.filter(name => !unwatch.includes(name));
    outcomes.push(
      removed.length
        ? { ok: true, message: `Stopped watching ${removed.join(', ')}.` }
        : { ok: false, message: `None of ${unwatch.join(', ')} was watched.` }
    );
  }

  const watch = listOf(settings.watch);
  if (watch?.length) {
    if (options.recording) {
      outcomes.push({
        ok: false,
        message:
          'A recording has no live measurements to start: its topics already show recorded counts and whole-file rates.',
      });
    } else {
      const unknown = watch.filter(name => !known(name));
      const wanted = watch.filter(name => known(name) && !watched.includes(name));
      const room = Math.max(0, WATCH_LIMIT - watched.length);
      const added = wanted.slice(0, room);
      watched = [...watched, ...added];
      if (added.length)
        outcomes.push({
          ok: true,
          message: `Watching ${added.join(', ')}.${discovering ? ' The graph is still being discovered, so a topic that does not exist will show as not measured.' : ''}`,
        });
      if (wanted.length > room)
        outcomes.push({
          ok: false,
          message: `The watch limit is ${WATCH_LIMIT} topics; ${wanted.slice(room).join(', ')} not watched.`,
        });
      if (unknown.length)
        outcomes.push({ ok: false, message: `No topic named ${unknown.join(', ')} is on the graph.` });
      if (!wanted.length && !unknown.length)
        outcomes.push({ ok: true, message: `${watch.join(', ')} already watched.` });
    }
  }

  const removeRules = settings.removeRules === 'all' ? rules.map(rule => rule.topic) : listOf(settings.removeRules);
  if (removeRules?.length) {
    const before = rules.length;
    rules = rules.filter(rule => !removeRules.includes(rule.topic));
    outcomes.push(
      rules.length < before
        ? {
            ok: true,
            message: `Removed the health rule${before - rules.length === 1 ? '' : 's'} for ${removeRules.join(', ')}.`,
          }
        : { ok: false, message: `No health rule exists for ${removeRules.join(', ')}.` }
    );
  }

  const ruleRequests = settings.addRules ?? settings.rules;
  if (ruleRequests !== undefined) {
    for (const candidate of Array.isArray(ruleRequests) ? ruleRequests : [ruleRequests]) {
      const item = (candidate && typeof candidate === 'object' ? candidate : {}) as Record<string, unknown>;
      const topic = typeof item.topic === 'string' ? item.topic.trim() : '';
      if (!topic.startsWith('/')) {
        outcomes.push({ ok: false, message: 'A health rule needs a topic name starting with "/".' });
        continue;
      }
      const thresholds: Partial<Rule> = {};
      for (const key of RULE_KEYS) {
        const value = item[key];
        if (value === null) thresholds[key] = undefined;
        else if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
          thresholds[key] = Math.min(value, 100000);
      }
      if (thresholds.minHz != null && thresholds.maxHz != null && thresholds.minHz > thresholds.maxHz) {
        outcomes.push({ ok: false, message: `The rule for ${topic} has a minimum rate above its maximum.` });
        continue;
      }
      const existing = rules.find(rule => rule.topic === topic);
      if (!existing && rules.length >= RULE_LIMIT) {
        outcomes.push({ ok: false, message: `The rule limit is ${RULE_LIMIT} topics; no rule added for ${topic}.` });
        continue;
      }
      const next: Rule = { ...(existing ?? { topic }), ...thresholds };
      // A rule without any threshold still alerts on silence, like the panel's own "add rule".
      if (!existing && RULE_KEYS.every(key => next[key] == null)) next.silenceSec = 5;
      for (const key of RULE_KEYS) if (next[key] === undefined) delete next[key];
      rules = existing ? rules.map(rule => (rule.topic === topic ? next : rule)) : [...rules, next];
      const summary = RULE_KEYS.filter(key => next[key] != null)
        .map(key => `${key} ${next[key]}`)
        .join(', ');
      outcomes.push({
        ok: true,
        message: `${existing ? 'Updated' : 'Added'} the health rule for ${topic} (${summary}).${known(topic) ? '' : ' That topic is not on the graph yet, so the rule reports it as missing.'}`,
      });
    }
  }

  for (const [key, add] of [
    ['pin', true],
    ['unpin', false],
  ] as const) {
    const names = listOf(settings[key]);
    if (!names?.length) continue;
    const ids = names.map(name => findResource(snapshot, name)?.id ?? (name.includes(':') ? name : `topic:${name}`));
    pinned = add ? [...new Set([...pinned, ...ids])] : pinned.filter(id => !ids.includes(id));
    outcomes.push({ ok: true, message: `${add ? 'Pinned' : 'Unpinned'} ${names.join(', ')}.` });
  }

  if (typeof settings.select === 'string') {
    if (!settings.select) {
      patch.selected = '';
      outcomes.push({ ok: true, message: 'Cleared the selection.' });
    } else {
      const reference = settings.select;
      const resource =
        findResource(snapshot, reference) ??
        (discovering && /^((topic|service|action|node):)?\//.test(reference)
          ? ({
              id: reference.includes(':') ? reference : `topic:${reference}`,
              kind: reference.includes(':') ? reference.split(':')[0] : 'topic',
              name: reference.replace(/^[a-z]+:/, ''),
            } as Resource)
          : undefined);
      if (resource) {
        patch.selected = resource.id;
        patch.kind = resource.kind;
        if (config.view === 'health' && settings.view === undefined) patch.view = 'resources';
        outcomes.push({ ok: true, message: `Selected the ${resource.kind} ${resource.name}.` });
      } else outcomes.push({ ok: false, message: `Nothing named ${settings.select} is on the graph.` });
    }
  }

  if (settings.view === 'resources' || settings.view === 'graph' || settings.view === 'health') {
    patch.view = settings.view;
    outcomes.push({ ok: true, message: `Showing the ${settings.view} view.` });
  }
  if (typeof settings.kind === 'string' && KINDS.includes(settings.kind as ResourceKind)) {
    patch.kind = settings.kind as ResourceKind;
    if (settings.select === undefined) patch.selected = '';
    outcomes.push({ ok: true, message: `Listing ${settings.kind}s.` });
  }
  if (typeof settings.query === 'string') {
    patch.query = settings.query.slice(0, 300);
    outcomes.push({ ok: true, message: settings.query ? `Filtering by "${settings.query}".` : 'Cleared the search.' });
  }
  if (typeof settings.showHidden === 'boolean') {
    patch.showHidden = settings.showHidden;
    outcomes.push({
      ok: true,
      message: settings.showHidden
        ? 'Showing hidden and infrastructure resources.'
        : 'Hiding infrastructure resources.',
    });
  }
  if (typeof settings.diagnosticTopic === 'string') {
    if (settings.diagnosticTopic.startsWith('/')) {
      patch.diagnosticTopic = settings.diagnosticTopic;
      outcomes.push({ ok: true, message: `Reading diagnostics from ${settings.diagnosticTopic}.` });
    } else outcomes.push({ ok: false, message: 'A diagnostic topic name starts with "/".' });
  }
  if (typeof settings.staleSec === 'number' && Number.isFinite(settings.staleSec)) {
    patch.staleSec = Math.max(1, Math.min(3600, settings.staleSec));
    outcomes.push({ ok: true, message: `Diagnostics count as stale after ${patch.staleSec} s without an update.` });
  }
  if (settings.source === 'follow' || settings.source === 'live') {
    patch.source = settings.source;
    outcomes.push({
      ok: true,
      message: settings.source === 'live' ? 'Inspecting the live robot.' : 'Following the open recording.',
    });
  }
  let logQuery: LogQuery | undefined;
  if (settings.logs === true || (settings.logs && typeof settings.logs === 'object' && !Array.isArray(settings.logs))) {
    const request = (settings.logs === true ? {} : settings.logs) as Record<string, unknown>;
    const level = typeof request.level === 'string' ? LOG_LEVELS[request.level.toLowerCase()] : undefined;
    logQuery = {
      ...(level != null ? { level } : {}),
      ...(typeof request.node === 'string' && request.node.trim() ? { node: request.node.trim() } : {}),
      ...(typeof request.text === 'string' && request.text.trim() ? { text: request.text.trim() } : {}),
      limit:
        typeof request.limit === 'number' && request.limit > 0
          ? Math.min(KEPT_LOGS, Math.floor(request.limit))
          : KEPT_LOGS,
    };
    const found = queryLogs(snapshot, logQuery).found;
    outcomes.push({ ok: true, message: `${found} of the ${snapshot.logs.length} kept /rosout entries match.` });
    if (typeof request.level === 'string' && level == null)
      outcomes.push({
        ok: false,
        message: `Unknown log level "${request.level}"; use debug, info, warning, error or fatal.`,
      });
  }
  const refresh = settings.refresh === true && !options.recording;
  if (refresh) outcomes.push({ ok: true, message: 'Asked the ROS host to rediscover the graph.' });

  if (watched.join('\n') !== config.watched.join('\n')) patch.watched = watched;
  if (JSON.stringify(rules) !== JSON.stringify(config.rules)) patch.rules = rules;
  if (pinned.join('\n') !== config.pinned.join('\n')) patch.pinned = pinned;

  const ignored = Object.keys(settings).filter(key => !KNOWN_KEYS.has(key));
  if (ignored.length)
    outcomes.push({
      ok: false,
      message: `The Data Explorer has no setting ${ignored.map(key => `"${key}"`).join(', ')}.`,
    });
  if (!outcomes.length)
    outcomes.push({
      ok: false,
      message: `Nothing in those settings applies to the Data Explorer. ${DATA_EXPLORER_SETTINGS_HELP}`,
    });
  return { patch, outcomes, refresh, ...(logQuery ? { logQuery } : {}) };
}

export const DATA_EXPLORER_CAPABILITY: AssistantCapability = {
  id: 'data-explorer',
  summary:
    'When a Data Explorer panel is open you see what it inspects: every topic, service, action and node with publisher/subscriber or server/client counts, measured rates and bandwidth of watched topics, QoS incompatibilities, diagnostics, recent /rosout logs, events and health rules with their state. You can start or stop measuring topics, add, change or remove health rules, select a resource to read its endpoints, schema and latest message, and switch its view.',
  detail: [
    'Do it with "configurePanel" on the open "dataExplorer" panel (its settingsHelp lists the keys). With no Data Explorer open, add one ("panelType":"dataExplorer") and configure it in the same operations list.',
    "Watching and health rules only observe, through the Robo-Boy inspection companion; they never publish to the robot's own topics. A rule topic is measured automatically.",
    'To read a resource\'s latest message, select it and put the question in "followUp": the message arrives in the panel\'s settings on the next turn.',
  ],
  invocations: [
    'watch /scan and /odom',
    'which topics have no subscribers',
    'add a health rule: /scan at least 9 Hz',
    'alert me if /cmd_vel goes silent for 2 seconds',
    'what do the diagnostics say',
    'show me the latest /rosout errors',
  ],
  responseKind: 'workspaceEdit',
};
