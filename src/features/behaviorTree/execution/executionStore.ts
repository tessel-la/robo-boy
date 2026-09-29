// The latest execution of each action and service node, kept apart from the tree itself: nodes read a one-word
// summary of theirs, and only the inspector reads the whole record. Feedback can arrive many times a second, so
// listeners hear about it at most every FEEDBACK_NOTIFY_MS.
import {
  applyExecutionUpdate,
  executionKey,
  summarizeExecution,
  type ExecutionRecord,
  type ExecutionSummary,
  type ExecutionUpdate,
} from './executionModel';
import { containsImage } from './richValues';

export const FEEDBACK_NOTIFY_MS = 100;

const sameSummary = (a: ExecutionSummary, b: ExecutionSummary) =>
  a.tone === b.tone && a.label === b.label && a.hasDetails === b.hasDetails && a.hasImage === b.hasImage;

type Listener = () => void;

export class ExecutionDetailsStore {
  private records = new Map<string, ExecutionRecord>();
  private summaries = new Map<string, ExecutionSummary>();
  private listeners = new Map<string, Set<Listener>>();
  private pending = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  get(key: string): ExecutionRecord | undefined {
    return this.records.get(key);
  }

  summary(key: string): ExecutionSummary | undefined {
    return this.summaries.get(key);
  }

  /** Records an update for a node; a stale update (from an attempt since replaced) changes nothing. */
  apply(nodeId: string, treePath: string[], update: ExecutionUpdate): void {
    const key = executionKey(nodeId, treePath);
    const previous = this.records.get(key);
    const next = applyExecutionUpdate(previous, nodeId, treePath, update);
    if (!next || next === previous) return;
    this.records.set(key, next);

    const previousSummary = this.summaries.get(key);
    const hadImage = previous?.attemptId === next.attemptId && (previousSummary?.hasImage ?? false);
    // Only a new result or feedback can bring an image; a phase change keeps what was found.
    const hasImage = 'result' in update || update.feedback !== undefined
      ? containsImage(next.result) || containsImage(next.feedback?.payload)
      : hadImage;
    const summary = summarizeExecution(next, hasImage);
    // An unchanged summary stays the same object, so the node showing it does not render again.
    const summaryUnchanged = Boolean(previousSummary && sameSummary(previousSummary, summary));
    this.summaries.set(key, summaryUnchanged ? previousSummary! : summary);

    // More feedback that changes nothing the tree shows can wait for the next batch.
    const onlyFeedback = update.feedback !== undefined && !update.begin && next.phase === previous?.phase
      && !('result' in update) && !update.error;
    if (onlyFeedback && summaryUnchanged) this.notifySoon(key);
    else this.notify(key);
  }

  /** Forgets every execution: a new run, another tree, another session. */
  clear(): void {
    const keys = [...this.records.keys()];
    this.records.clear();
    this.summaries.clear();
    this.pending.clear();
    keys.forEach(key => this.notify(key));
  }

  /** Executions still running when their executor went away (ROS lost, runner stopped) ended there. */
  interruptRunning(message: string): void {
    [...this.records.values()]
      .filter(record => record.phase === 'running')
      .forEach(record => this.apply(record.nodeId, record.treePath, {
        attemptId: record.attemptId,
        kind: record.kind,
        target: record.target,
        phase: 'transport',
        error: { message, source: 'transport' },
      }));
  }

  subscribe(key: string, listener: Listener): () => void {
    const set = this.listeners.get(key) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.listeners.clear();
  }

  private notify(key: string): void {
    this.pending.delete(key);
    this.listeners.get(key)?.forEach(listener => listener());
  }

  private notifySoon(key: string): void {
    this.pending.add(key);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      [...this.pending].forEach(pendingKey => this.notify(pendingKey));
    }, FEEDBACK_NOTIFY_MS);
  }
}
