import { BehaviorTree, ROSDiscoveryResult } from '../types';
import type { ActionGoalDetails } from '../services/rosDiscovery';

export type AgentProvider = 'openai' | 'gemini' | 'openai-compatible';

export interface BehaviorTreeAgentSettings {
  provider: AgentProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemContext: string;
  robotContext: string;
  includeCurrentTree: boolean;
}

export type BehaviorTreeAgentTreeContextMode = 'open' | 'selection' | 'open-and-selection';

export interface BehaviorTreeAgentTreeContext {
  mode: BehaviorTreeAgentTreeContextMode;
  openTree?: BehaviorTree;
  selectedTree?: BehaviorTree;
  note?: string;
}

export interface BehaviorTreeAgentRequest {
  prompt: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: BehaviorTreeAgentSettings;
  currentTree: BehaviorTree | null;
  treeContext?: BehaviorTreeAgentTreeContext | null;
  rosResources: ROSDiscoveryResult;
  resourceSchemas: BehaviorTreeResourceSchemas;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
  onProgress?: (message: string) => void;
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

export type GeneratedAgentResponse =
  | { kind: 'tree'; tree: BehaviorTree }
  | AgentClarification;
