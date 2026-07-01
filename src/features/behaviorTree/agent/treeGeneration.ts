import { Edge } from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import { arrangeBehaviorTree } from '../layoutUtils';
import {
  BehaviorNodeData,
  BehaviorNodeType,
  BehaviorTree,
  BehaviorTreeNode,
  ExecutionStatus,
} from '../types';
import { BehaviorTreeResourceSchemas, GeneratedAgentResponse } from './types';

const SUPPORTED_TYPES = new Set<string>([
  BehaviorNodeType.Sequence,
  BehaviorNodeType.Selector,
  BehaviorNodeType.Parallel,
  BehaviorNodeType.Retry,
  BehaviorNodeType.Repeat,
  BehaviorNodeType.Timeout,
  BehaviorNodeType.IfElse,
  BehaviorNodeType.Subtree,
  BehaviorNodeType.Action,
  BehaviorNodeType.Service,
  BehaviorNodeType.Topic,
  BehaviorNodeType.Subscriber,
]);

const asRecord = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
};

const stripCodeFence = (value: string): string => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1) : value;
};

const mergeDefaults = (defaults: unknown, supplied: unknown): any => {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return supplied === undefined ? defaults : supplied;
  }
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    return supplied === undefined ? defaults : supplied;
  }
  const result: Record<string, any> = { ...(defaults as Record<string, any>) };
  Object.entries(supplied as Record<string, any>).forEach(([key, value]) => {
    result[key] = mergeDefaults(result[key], value);
  });
  return result;
};

const nodeData = (
  type: BehaviorNodeType,
  raw: Record<string, any>,
  schemas: BehaviorTreeResourceSchemas
): BehaviorNodeData => {
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : type;
  const config = raw.config && typeof raw.config === 'object' ? raw.config : {};
  const base = { label, status: ExecutionStatus.Idle };

  switch (type) {
    case BehaviorNodeType.Action:
      { const actionType = String(config.actionType ?? raw.actionType ?? ''); return { ...base, actionName: String(config.actionName ?? raw.actionName ?? ''), actionType, parameters: mergeDefaults(schemas.actions[actionType]?.defaults ?? {}, config.parameters ?? raw.parameters ?? {}), timeout: config.timeout ?? raw.timeout, inputBindings: Array.isArray(config.inputBindings) ? config.inputBindings : [], outputBindings: Array.isArray(config.outputBindings) ? config.outputBindings : [] }; }
    case BehaviorNodeType.Service:
      { const serviceType = String(config.serviceType ?? raw.serviceType ?? ''); return { ...base, serviceName: String(config.serviceName ?? raw.serviceName ?? ''), serviceType, request: mergeDefaults(schemas.services[serviceType]?.defaults ?? {}, config.request ?? raw.request ?? {}), timeout: config.timeout ?? raw.timeout, inputBindings: Array.isArray(config.inputBindings) ? config.inputBindings : [], outputBindings: Array.isArray(config.outputBindings) ? config.outputBindings : [] }; }
    case BehaviorNodeType.Topic:
      return { ...base, topicName: String(config.topicName ?? raw.topicName ?? ''), messageType: String(config.messageType ?? raw.messageType ?? ''), message: config.message ?? raw.message, publishOnce: config.publishOnce ?? raw.publishOnce, frequencyHz: config.frequencyHz ?? raw.frequencyHz, durationMs: config.durationMs ?? raw.durationMs, inputBindings: Array.isArray(config.inputBindings) ? config.inputBindings : [] };
    case BehaviorNodeType.Subscriber:
      return { ...base, topicName: String(config.topicName ?? raw.topicName ?? ''), messageType: String(config.messageType ?? raw.messageType ?? ''), timeout: config.timeout ?? raw.timeout ?? 10000, outputBindings: Array.isArray(config.outputBindings) ? config.outputBindings : [] };
    case BehaviorNodeType.Timeout:
      return { ...base, timeout: Number.isFinite(config.timeout) ? config.timeout : 10000 };
    case BehaviorNodeType.IfElse:
      return { ...base, variable: String(config.variable ?? raw.variable ?? ''), operator: config.operator ?? raw.operator ?? 'truthy', expectedValue: config.expectedValue ?? raw.expectedValue } as BehaviorNodeData;
    case BehaviorNodeType.Retry:
    case BehaviorNodeType.Repeat:
      return { ...base, type, description: config.description, iterationLimit: Number.isFinite(config.iterationLimit) ? config.iterationLimit : 3 };
    default:
      return { ...base, type } as BehaviorNodeData;
  }
};

const normalizeTree = (value: unknown, schemas: BehaviorTreeResourceSchemas): BehaviorTree => {
  const raw = asRecord(value, 'Generated tree');
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Generated tree must contain nodes and edges arrays.');
  }

  const usedIds = new Set<string>();
  const nodes: BehaviorTreeNode[] = raw.nodes.map((value: unknown, index: number) => {
    const candidate = asRecord(value, `Node ${index + 1}`);
    const type = String(candidate.type ?? '') as BehaviorNodeType;
    if (!SUPPORTED_TYPES.has(type)) throw new Error(`Node ${index + 1} has unsupported type "${type}".`);
    let id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `node-${index}`;
    while (usedIds.has(id)) id = `${id}-${index}`;
    usedIds.add(id);

    if (type === BehaviorNodeType.Subtree) {
      const nested = normalizeTree(candidate.tree ?? candidate.config?.tree, schemas);
      return {
        id,
        type,
        position: { x: Number(candidate.x) || 0, y: Number(candidate.y) || 0 },
        data: { label: String(candidate.label || nested.name), tree: nested },
      };
    }

    return {
      id,
      type,
      position: { x: Number(candidate.x) || 0, y: Number(candidate.y) || 0 },
      data: nodeData(type, candidate, schemas),
    };
  });

  const edges: Edge[] = raw.edges.map((value: unknown, index: number) => {
    const candidate = asRecord(value, `Edge ${index + 1}`);
    const source = String(candidate.source ?? '');
    const target = String(candidate.target ?? '');
    if (!usedIds.has(source) || !usedIds.has(target)) {
      throw new Error(`Edge ${index + 1} references a missing node.`);
    }
    const sourceHandle = candidate.sourceHandle === 'then' || candidate.sourceHandle === 'else'
      ? candidate.sourceHandle
      : null;
    return { id: `edge-${index}-${uuidv4()}`, source, target, sourceHandle, targetHandle: null };
  });

  const incoming = new Map(nodes.map(node => [node.id, 0]));
  edges.forEach(edge => incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1));
  if (nodes.length > 0 && !nodes.some(node => (incoming.get(node.id) ?? 0) === 0)) {
    throw new Error('Generated tree has no root node (it may contain a cycle).');
  }

  const now = Date.now();
  const tree: BehaviorTree = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uuidv4(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'AI generated tree',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    blackboardDefaults: raw.blackboardDefaults && typeof raw.blackboardDefaults === 'object' && !Array.isArray(raw.blackboardDefaults)
      ? raw.blackboardDefaults
      : undefined,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
  return { ...tree, nodes: arrangeBehaviorTree(tree.nodes, tree.edges) };
};

const EMPTY_SCHEMAS: BehaviorTreeResourceSchemas = { actions: {}, services: {} };

export const parseGeneratedBehaviorTree = (
  text: string,
  schemas: BehaviorTreeResourceSchemas = EMPTY_SCHEMAS
): BehaviorTree => {
  try {
    return normalizeTree(JSON.parse(stripCodeFence(text)), schemas);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The model did not return valid JSON. Try again or use a stronger model.');
    throw error;
  }
};

export const parseGeneratedAgentResponse = (
  text: string,
  schemas: BehaviorTreeResourceSchemas = EMPTY_SCHEMAS
): GeneratedAgentResponse => {
  let value: Record<string, any>;
  try {
    value = asRecord(JSON.parse(stripCodeFence(text)), 'Agent response');
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The model did not return valid JSON. Try again or use a stronger model.');
    throw error;
  }
  if (value.kind === 'clarification') {
    if (typeof value.question !== 'string' || !value.question.trim()) {
      throw new Error('The model returned an empty clarification question.');
    }
    return {
      kind: 'clarification',
      question: value.question.trim(),
      missing: Array.isArray(value.missing) ? value.missing.map(String) : undefined,
      suggestions: Array.isArray(value.suggestions) ? value.suggestions.map(String).slice(0, 4) : undefined,
    };
  }
  return { kind: 'tree', tree: normalizeTree(value, schemas) };
};
