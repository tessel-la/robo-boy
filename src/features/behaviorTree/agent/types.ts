import { BehaviorTree } from '../types';
import type { ActionGoalDetails } from '../services/rosDiscovery';

// This file now holds only the BT tool's output/parsing-domain types — everything chat/provider-UI
// specific (settings, providers, attachments, tree-context assembly) moved to
// src/features/assistant/ when the BT-owned chat assistant was replaced by the global assistant.
// Kept here because treeGeneration.ts (parse/repair — unaffected by that migration) and
// BehaviorTreePanel.tsx (checkpoint typing for its own undo/redo-based bridge) still depend on it.

export interface BehaviorTreeAgentCheckpoint {
  tree: BehaviorTree;
  activeTree: BehaviorTree | null;
  path: string[];
}

export interface BehaviorTreeResourceSchemas {
  actions: Record<string, ActionGoalDetails>;
  services: Record<string, ActionGoalDetails>;
}

export interface AgentClarification {
  kind: 'clarification';
  question: string;
  missing?: string[];
  suggestions?: string[];
}

export interface AgentExplanation {
  kind: 'explanation';
  message: string;
}

export type GeneratedAgentResponse = { kind: 'tree'; tree: BehaviorTree } | AgentClarification | AgentExplanation;
