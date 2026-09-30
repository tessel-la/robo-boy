import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { executionKey, type ExecutionRecord, type ExecutionSummary } from './executionModel';
import type { ExecutionDetailsStore } from './executionStore';

export interface ExecutionDetailsContextValue {
  store: ExecutionDetailsStore;
  /** The subtree the canvas shows, so a node finds its own execution. */
  treePath: string[];
  /** Opens a node's execution details. */
  open: (nodeId: string) => void;
  /** The node whose details are open, if any. */
  openNodeId: string | null;
}

export const ExecutionDetailsContext = createContext<ExecutionDetailsContextValue | null>(null);

const noSubscription = () => () => {};

/** What a node shows of its latest execution: a summary that changes only when the chip would. */
export function useExecutionSummary(nodeId: string): { summary: ExecutionSummary | undefined; context: ExecutionDetailsContextValue | null } {
  const context = useContext(ExecutionDetailsContext);
  const key = context ? executionKey(nodeId, context.treePath) : '';
  const subscribe = useCallback(
    (listener: () => void) => (context ? context.store.subscribe(key, listener) : noSubscription()),
    [context, key]
  );
  const summary = useSyncExternalStore(subscribe, () => (context ? context.store.summary(key) : undefined));
  return { summary, context };
}

/** The whole latest execution of a node, live. */
export function useExecutionRecord(store: ExecutionDetailsStore, key: string | null): ExecutionRecord | undefined {
  const subscribe = useCallback(
    (listener: () => void) => (key ? store.subscribe(key, listener) : noSubscription()),
    [key, store]
  );
  return useSyncExternalStore(subscribe, () => (key ? store.get(key) : undefined));
}
