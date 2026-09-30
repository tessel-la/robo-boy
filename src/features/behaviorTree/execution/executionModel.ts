// What a ROS action or service node did when it last ran: its state, the feedback it received, what it returned and
// why it failed. Both executors (the browser one and the ROS-side runner) report executions in this one shape, so the
// tree shows actions and services the same way whatever ran them.

export type ExecutionKind = 'action' | 'service';

/**
 * - `running`: an action goal is in flight, or a service call is waiting for its response.
 * - `succeeded`: the goal succeeded, or the service responded.
 * - `failed`: the goal was aborted or rejected, or the call failed.
 * - `cancelled`: the goal was cancelled (by the robot, or because the tree stopped).
 * - `timeout`: no result within the node's timeout.
 * - `transport`: the connection to ROS failed while it ran.
 */
export type ExecutionPhase = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout' | 'transport';

export type ExecutionErrorSource = 'ros' | 'timeout' | 'transport' | 'client' | 'stopped';

export interface ExecutionError {
  message: string;
  /** An error or status code, when the robot gave one. */
  code?: string | number;
  source: ExecutionErrorSource;
  /** Anything else the robot returned about the failure. */
  details?: unknown;
}

export interface ExecutionFeedback {
  payload: unknown;
  receivedAt: number;
  /** How many feedback messages this execution has received. */
  count: number;
}

/** The execution of one node, once. */
export interface ExecutionRecord {
  /** Which node, in which tree: `<subtree path or root>::<node id>`. */
  key: string;
  nodeId: string;
  treePath: string[];
  /** Tells this execution apart from earlier and later ones of the same node. */
  attemptId: string;
  kind: ExecutionKind;
  /** The action or service name. */
  target: string;
  /** The action or service type, when known. */
  rosType?: string;
  phase: ExecutionPhase;
  /** action_msgs/GoalStatus of an action's goal, when rosbridge or the runner reported one. */
  goalStatus?: number;
  startedAt: number;
  endedAt?: number;
  feedback?: ExecutionFeedback;
  /** The action result or the service response. */
  result?: unknown;
  hasResult: boolean;
  error?: ExecutionError;
}

/** What an executor reports: the start of an execution, or a change to one already started. */
export interface ExecutionUpdate {
  attemptId: string;
  kind: ExecutionKind;
  target: string;
  rosType?: string;
  phase: ExecutionPhase;
  /** The execution starts over: anything recorded for the node before is dropped. */
  begin?: boolean;
  goalStatus?: number;
  feedback?: unknown;
  result?: unknown;
  error?: ExecutionError;
  at?: number;
}

export const executionKey = (nodeId: string, treePath: readonly string[]): string =>
  `${treePath.join('/') || 'root'}::${nodeId}`;

// action_msgs/msg/GoalStatus
export const GOAL_STATUS = {
  UNKNOWN: 0,
  ACCEPTED: 1,
  EXECUTING: 2,
  CANCELING: 3,
  SUCCEEDED: 4,
  CANCELED: 5,
  ABORTED: 6,
} as const;

const GOAL_STATUS_NAMES: Record<number, string> = {
  0: 'Unknown',
  1: 'Accepted',
  2: 'Executing',
  3: 'Canceling',
  4: 'Succeeded',
  5: 'Canceled',
  6: 'Aborted',
};

export const goalStatusName = (status: number | undefined): string | undefined =>
  status === undefined ? undefined : (GOAL_STATUS_NAMES[status] ?? `Status ${status}`);

/** The phase an action's final goal status stands for. */
export const phaseForGoalStatus = (status: number | undefined): ExecutionPhase => {
  if (status === GOAL_STATUS.SUCCEEDED) return 'succeeded';
  if (status === GOAL_STATUS.CANCELED) return 'cancelled';
  return 'failed';
};

/** Applies an update to what is known of a node's execution; a new attempt replaces the old one entirely. */
export function applyExecutionUpdate(
  previous: ExecutionRecord | undefined,
  nodeId: string,
  treePath: string[],
  update: ExecutionUpdate
): ExecutionRecord | undefined {
  const at = update.at ?? Date.now();
  const isNewAttempt = update.begin || !previous || previous.attemptId !== update.attemptId;
  // A late message from an attempt that has since been replaced says nothing about the current one.
  if (isNewAttempt && !update.begin && previous && previous.attemptId !== update.attemptId) return previous;

  const base: ExecutionRecord = isNewAttempt
    ? {
      key: executionKey(nodeId, treePath),
      nodeId,
      treePath,
      attemptId: update.attemptId,
      kind: update.kind,
      target: update.target,
      rosType: update.rosType,
      phase: update.phase,
      startedAt: at,
      hasResult: false,
    }
    : previous;

  const next: ExecutionRecord = {
    ...base,
    phase: update.phase,
    rosType: update.rosType ?? base.rosType,
    goalStatus: update.goalStatus ?? base.goalStatus,
  };
  if (update.phase !== 'running') next.endedAt = at;
  if (update.feedback !== undefined) {
    next.feedback = { payload: update.feedback, receivedAt: at, count: (base.feedback?.count ?? 0) + 1 };
  }
  if ('result' in update) {
    next.result = update.result;
    next.hasResult = true;
  }
  if (update.error) next.error = update.error;
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Diagnostics: what a result or response says about how things went, whatever message type it is.

export interface Diagnostics {
  /** The payload reports failure itself (`success: false`, a non-zero error code…). */
  reportsFailure: boolean;
  message?: string;
  code?: string | number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SUCCESS_FIELDS = ['success', 'succeeded', 'ok', 'result'];
const MESSAGE_FIELDS = ['error_msg', 'error_message', 'error_string', 'message', 'status_message', 'reason', 'error'];
const CODE_FIELDS = ['error_code', 'code', 'status_code', 'return_code'];

/** Reads the conventional status fields of a result or response (`success`, `message`, `error_code`, …). */
export function extractDiagnostics(payload: unknown): Diagnostics {
  if (!isRecord(payload)) return { reportsFailure: false };
  const successField = SUCCESS_FIELDS.find(name => typeof payload[name] === 'boolean');
  const message = MESSAGE_FIELDS
    .map(name => payload[name])
    .find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const rawCode = CODE_FIELDS.map(name => payload[name]).find(value => typeof value === 'number' || typeof value === 'string');
  // Error codes are sometimes a message of their own, e.g. nav2's `error_code: {value}` style.
  const nestedCode = CODE_FIELDS.map(name => payload[name]).find(isRecord);
  const code = rawCode ?? (nestedCode && (typeof nestedCode.value === 'number' || typeof nestedCode.value === 'string')
    ? nestedCode.value as number | string
    : undefined);
  const codeSignalsFailure = typeof code === 'number' ? code !== 0 : false;
  const reportsFailure = (successField !== undefined && payload[successField] === false)
    || (successField === undefined && codeSignalsFailure);
  return { reportsFailure, message: message?.trim(), code };
}

/** Whether a payload has anything in it worth looking at (ROS answers "nothing" with `{}`). */
export function isEmptyPayload(payload: unknown): boolean {
  if (payload === undefined || payload === null || payload === '') return true;
  if (Array.isArray(payload)) return payload.length === 0;
  if (!isRecord(payload)) return false;
  const keys = Object.keys(payload).filter(key => key !== 'structure_needs_at_least_one_member');
  return keys.length === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// What the tree shows of an execution without opening it.

export type ExecutionTone = 'running' | 'success' | 'warning' | 'error' | 'neutral';

export interface ExecutionSummary {
  tone: ExecutionTone;
  /** Short status for the chip's tooltip and the inspector heading. */
  label: string;
  /** There is something to open: feedback, a result, an error or diagnostics. */
  hasDetails: boolean;
  /** The result or feedback holds an image. */
  hasImage: boolean;
}

export function describePhase(record: Pick<ExecutionRecord, 'kind' | 'phase' | 'feedback' | 'goalStatus'>): string {
  const isAction = record.kind === 'action';
  switch (record.phase) {
    case 'running':
      return isAction ? (record.feedback ? 'Running · feedback received' : 'Running') : 'Calling';
    case 'succeeded':
      return isAction ? 'Succeeded' : 'Responded';
    case 'failed':
      return isAction ? (record.goalStatus === GOAL_STATUS.ABORTED ? 'Aborted' : 'Failed') : 'Call failed';
    case 'cancelled':
      return 'Cancelled';
    case 'timeout':
      return 'Timed out';
    case 'transport':
      return 'Connection lost';
  }
}

export function summarizeExecution(record: ExecutionRecord, hasImage = false): ExecutionSummary {
  const diagnostics = record.hasResult ? extractDiagnostics(record.result) : { reportsFailure: false };
  const label = describePhase(record);
  const stoppedByTree = record.phase === 'cancelled' && record.error?.source === 'stopped';

  if (record.phase === 'running') {
    return { tone: 'running', label, hasDetails: record.feedback !== undefined, hasImage };
  }
  if (record.phase === 'succeeded') {
    return {
      tone: diagnostics.reportsFailure ? 'warning' : 'success',
      label: diagnostics.reportsFailure ? `${label} · reported failure` : label,
      hasDetails: record.hasResult && !isEmptyPayload(record.result),
      hasImage,
    };
  }
  // Stopping the tree cancels what was running: that is not news about the node, unless the robot said more.
  const hasPayload = record.hasResult && !isEmptyPayload(record.result);
  return {
    tone: record.phase === 'cancelled' ? 'neutral' : 'error',
    label,
    hasDetails: stoppedByTree ? hasPayload : Boolean(record.error) || hasPayload || record.feedback !== undefined,
    hasImage,
  };
}
