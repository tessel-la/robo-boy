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

export type BehaviorTreeAgentTreeContextMode = 'open' | 'selection' | 'open-and-selection' | 'additional';

export interface BehaviorTreeAgentTreeContext {
  mode: BehaviorTreeAgentTreeContextMode;
  openTree?: BehaviorTree;
  selectedTree?: BehaviorTree;
  note?: string;
  additionalContext?: BehaviorTreeAgentContextItem[];
}

export interface BehaviorTreeAgentContextItem {
  id: string;
  kind: 'tree' | 'node' | 'ros';
  label: string;
  value: unknown;
}

export interface BehaviorTreeAgentAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'text' | 'image';
  content: string;
}

export interface BehaviorTreeAgentCheckpoint {
  tree: BehaviorTree;
  activeTree: BehaviorTree | null;
  path: string[];
}

export interface BehaviorTreeAgentRequest {
  prompt: string;
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: BehaviorTreeAgentSettings;
  currentTree: BehaviorTree | null;
  treeContext?: BehaviorTreeAgentTreeContext | null;
  rosResources: ROSDiscoveryResult;
  resourceSchemas: BehaviorTreeResourceSchemas;
  attachments?: BehaviorTreeAgentAttachment[];
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

export interface AgentExplanation {
  kind: 'explanation';
  message: string;
}

export type GeneratedAgentResponse = { kind: 'tree'; tree: BehaviorTree } | AgentClarification | AgentExplanation;
