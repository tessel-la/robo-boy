import { useLayoutEffect, useRef } from 'react';
import { createPanelPresentationRegistry } from '../../panels/presentationRegistry';
import type { BehaviorTree, BehaviorTreeNode } from './types';
import type { Edge } from 'reactflow';
import type { BehaviorTreeExecutionSnapshot } from './components/BehaviorTreePanel';

export interface BehaviorTreePresentation {
  tree: BehaviorTree | null;
  nodes: readonly BehaviorTreeNode[];
  edges: readonly Edge[];
  execution: BehaviorTreeExecutionSnapshot;
  connected: boolean;
  executing: boolean;
  paused: boolean;
  persistent: boolean;
  blackboard: Record<string, unknown>;
  path: readonly string[];
  enterSubtree(id: string): void;
  up(): void;
  execute(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  load(tree: BehaviorTree): void;
  setPersistent(value: boolean): void;
}
const registry = createPanelPresentationRegistry<() => BehaviorTreePresentation>();
export const getBehaviorTreePresentation = registry.get;
export function useBehaviorTreePresentation(id: string, scope: string | undefined, state: BehaviorTreePresentation) {
  const latest = useRef(state);
  latest.current = state;
  useLayoutEffect(() => registry.register(id, () => latest.current, scope), [id, scope]);
}
