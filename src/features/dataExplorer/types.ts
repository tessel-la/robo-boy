export type ResourceKind = 'topic' | 'service' | 'action' | 'node';
export interface Endpoint {
  id: string;
  node: string;
  role: 'publisher' | 'subscriber';
  type: string;
  observer?: boolean;
  qos: Record<string, string | number>;
}
export interface SchemaField {
  name: string;
  type: string;
  fields?: SchemaField[];
  /** Why a nested type could not be expanded. */
  unresolved?: string;
}
export interface Resource {
  id: string;
  kind: ResourceKind;
  name: string;
  types: string[];
  providers: string[];
  consumers: string[];
  publishers?: number;
  subscribers?: number;
  clients?: number;
  servers?: number;
  countKind?: 'endpoints' | 'nodes';
  instances?: number;
  endpoints?: Endpoint[];
  compatibility?: { publisher: string; subscriber: string; level: string; reason: string }[];
  /** Interface parts (Message, Request/Response, Goal/Result/Feedback) as nested field trees. */
  schemas?: Record<string, SchemaField[]>;
  constants?: Record<string, { name: string; value: string | number | boolean }[]>;
  /** Full message definition text, when the source has it (an MCAP file stores one per channel). */
  definition?: string;
  error?: string;
  recordedCount?: number;
}
export interface Metric {
  rate: number | null;
  bytesPerSec: number | null;
  age: number | null;
  count: number;
  window: number;
  source: 'host' | 'browser' | 'recorded';
  warming?: boolean;
  intervalRate?: number | null;
  intervalMean?: number | null;
  intervalMin?: number | null;
  intervalMax?: number | null;
  jitter?: number | null;
  meanBytes?: number | null;
  maxBytes?: number;
  /** Seconds this client has been watching the topic. Unlike `window`, it is not capped at the
   * measurement window, so a silence timeout longer than the window can still be judged. */
  observed?: number;
  /** Set when no measurement is possible (no probe, unknown type); rate/age are then unknown, not zero. */
  unavailable?: string;
  /** Highest rate the source can report (browser previews are throttled); a rate near it is a lower bound. */
  ceiling?: number;
}
export interface Preview {
  value: unknown;
  previous?: unknown;
  receivedAt: number;
  truncated: boolean;
}
export interface Diagnostic {
  id: string;
  source: string;
  name: string;
  hardware: string;
  level: number;
  message: string;
  values: { key: string; value: string }[];
  receivedAt: number;
}
export interface LogEntry {
  id: number;
  name: string;
  level: number;
  message: string;
  receivedAt: number;
  repeats: number;
}
export interface InspectionEvent {
  id: number;
  time: number;
  label: string;
  level: number;
}
export interface InspectionSnapshot {
  resources: Resource[];
  metrics: Record<string, Metric>;
  previews: Record<string, Preview>;
  trends: Record<string, { time: number; rate: number; bytes: number }[]>;
  diagnostics: Diagnostic[];
  logs: LogEntry[];
  events: InspectionEvent[];
  mode: 'host' | 'browser' | 'recorded';
  online: boolean;
  loading: boolean;
  updatedAt: number;
  now: number;
  errors: string[];
  truncated: boolean;
  /** Watched topics the companion refused because the shared probe budget is full. */
  refused: string[];
  /** Goals seen on each selected action's status topic, newest first. */
  goals: Record<string, ActionGoal[]>;
}
/** action_msgs/msg/GoalStatus codes. */
export const GOAL_STATUS = [
  'Unknown',
  'Accepted',
  'Executing',
  'Canceling',
  'Succeeded',
  'Canceled',
  'Aborted',
] as const;
export interface ActionGoal {
  id: string;
  status: number;
  /** When this client first saw the goal, and when its status last changed (snapshot clock, ms). */
  firstSeen: number;
  changedAt: number;
  history: { status: number; time: number }[];
}
export interface Rule {
  topic: string;
  minHz?: number;
  maxHz?: number;
  silenceSec?: number;
  minPublishers?: number;
  minSubscribers?: number;
}
/** The numeric columns of the resource list. */
export type ExplorerColumn = 'providers' | 'consumers' | 'rate';

export interface ExplorerConfig {
  version: 1;
  view: 'resources' | 'graph' | 'health';
  kind: ResourceKind;
  query: string;
  selected: string;
  watched: string[];
  pinned: string[];
  showHidden: boolean;
  source: 'follow' | 'live';
  rules: Rule[];
  /** Column the list is sorted by. Providers are publishers, servers, recorded messages or the topics a
   * node publishes; consumers are subscribers, clients or the topics a node subscribes to. */
  sort: ExplorerColumn | 'name';
  sortDir: 'asc' | 'desc';
  /** User-resized column widths in pixels; the name column takes the rest. */
  columns: Record<ExplorerColumn, number>;
  diagnosticTopic: string;
  staleSec: number;
  positions: Record<string, { x: number; y: number }>;
}
export interface InspectionDemand {
  watch: string[];
  selected: string;
  health: boolean;
  diagnosticTopic: string;
}
