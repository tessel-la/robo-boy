import { assertSafeFieldPath, collection, parseContentJson, record, text } from '../library/json';
import { readContentPackage } from '../library/packages';
import { createUuid } from '../../utils/uuid';
import { validateTreeStructure } from './validation';
import { BehaviorNodeType, type BehaviorTree } from './types';

const fields: Record<string, string[]> = {
  sequence: ['type', 'description', 'generatedBySubtreeWrap'],
  selector: ['type', 'description'],
  parallel: ['type', 'description'],
  retry: ['type', 'description', 'iterationLimit'],
  repeat: ['type', 'description', 'iterationLimit'],
  timeout: ['timeout'],
  ifElse: ['variable', 'operator', 'expectedValue'],
  condition: ['condition', 'expectedValue', 'operator'],
  action: ['actionName', 'actionType', 'parameters', 'timeout', 'inputBindings', 'outputBindings'],
  service: ['serviceName', 'serviceType', 'request', 'timeout', 'inputBindings', 'outputBindings'],
  topic: ['topicName', 'messageType', 'message', 'publishOnce', 'frequencyHz', 'durationMs', 'inputBindings'],
  subscriber: ['topicName', 'messageType', 'timeout', 'outputBindings'],
  subtree: ['tree'],
};
export function decodeTree(value: unknown, depth = 0): BehaviorTree {
  if (depth > 10) throw new Error('Subtree nesting exceeds ten levels.');
  const tree = record(value, 'Behavior tree');
  text(tree.id, 'Tree id');
  text(tree.name, 'Tree name');
  collection(tree.nodes, 'Tree nodes', 500);
  collection(tree.edges, 'Tree edges', 1000);
  // Reject malformed graph members before calling the domain validator.
  for (const node of tree.nodes) {
    record(node, 'Node');
    text(node.id, 'Node id');
    record(node.data, 'Node data');
  }
  const edgeIds = new Set<string>();
  for (const edge of tree.edges) {
    record(edge, 'Edge');
    text(edge.id, 'Edge id');
    text(edge.source, 'Edge source');
    text(edge.target, 'Edge target');
    if (edgeIds.has(edge.id)) throw new Error('Edge ids must be unique.');
    edgeIds.add(edge.id);
  }
  const errors = validateTreeStructure(tree as BehaviorTree);
  if (errors.length) throw new Error(errors.join(' '));
  for (const node of tree.nodes) {
    const data = node.data;
    text(data.label, 'Node label');
    const kind = node.type;
    if (kind === 'subtree' && data.tree === undefined) throw new Error('Subtree is missing its embedded tree.');
    if (kind === 'action') {
      text(data.actionName, 'Action name');
      text(data.actionType, 'Action type');
    }
    if (kind === 'service') {
      text(data.serviceName, 'Service name');
      text(data.serviceType, 'Service type');
    }
    if (['topic', 'subscriber'].includes(kind)) {
      text(data.topicName, 'Topic name');
      text(data.messageType, 'Message type');
    }
    for (const key of ['parameters', 'request', 'message']) if (data[key] !== undefined) record(data[key], key);
    for (const key of ['timeout', 'frequencyHz', 'durationMs', 'iterationLimit'])
      if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0))
        throw new Error(`Invalid ${key}.`);
    for (const key of ['inputBindings', 'outputBindings'])
      if (data[key] !== undefined)
        for (const binding of collection(data[key], key, 500)) {
          const item = record(binding, 'Blackboard binding');
          text(item.variable, 'Blackboard variable');
          text(item[key === 'inputBindings' ? 'targetPath' : 'sourcePath'], 'Binding path');
          assertSafeFieldPath(item[key === 'inputBindings' ? 'targetPath' : 'sourcePath'], 'Binding path');
        }
    if (kind === 'ifElse') {
      text(data.variable, 'Blackboard variable');
      text(data.operator, 'Comparison operator');
    }
    if (kind === 'condition') text(data.condition, 'Condition');
    if (data.publishOnce !== undefined && typeof data.publishOnce !== 'boolean')
      throw new Error('Invalid publishOnce.');
  }
  if (tree.blackboardDefaults !== undefined) record(tree.blackboardDefaults, 'Blackboard defaults');
  if (tree.blackboardTypes !== undefined) {
    const types = new Set([
      'bool',
      'int32',
      'int64',
      'float32',
      'float64',
      'string',
      'numberArray',
      'stringArray',
      'vector3',
      'point',
      'quaternion',
      'pose',
      'twist',
      'time',
      'duration',
      'json',
    ]);
    if (Object.values(record(tree.blackboardTypes, 'Blackboard types')).some(type => !types.has(String(type))))
      throw new Error('Unknown blackboard type.');
  }
  return {
    id: tree.id,
    name: tree.name,
    description: typeof tree.description === 'string' ? tree.description : undefined,
    createdAt: typeof tree.createdAt === 'number' ? tree.createdAt : 0,
    updatedAt: typeof tree.updatedAt === 'number' ? tree.updatedAt : 0,
    blackboardDefaults: tree.blackboardDefaults,
    blackboardTypes: tree.blackboardTypes,
    nodes: tree.nodes.map((node: any) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: Object.fromEntries(
        ['label', ...fields[node.type]]
          .filter(key => node.data[key] !== undefined)
          .map(key => [
            key,
            key === 'tree' && node.type === BehaviorNodeType.Subtree
              ? decodeTree(node.data.tree, depth + 1)
              : node.data[key],
          ])
      ),
    })),
    edges: tree.edges.map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === 'string' ? { targetHandle: edge.targetHandle } : {}),
    })),
  };
}
export function readTree(source: string): BehaviorTree {
  const value = parseContentJson(source);
  const pack = readContentPackage(value);
  if (pack) {
    if (pack.documents.length !== 1 || pack.documents[0].kind !== 'behaviorTree')
      throw new Error('This importer accepts one Behavior Tree with embedded subtrees.');
    return decodeTree(pack.documents[0].data);
  }
  const data = record(value, 'Behavior tree file');
  if (data.version !== undefined && data.version !== '1.0.0')
    throw new Error('Unsupported Behavior Tree file version.');
  return decodeTree(data.tree);
}
/** Embedded subtrees are independent snapshots; imported source links never attach to local trees. */
export function copyTree(tree: BehaviorTree): BehaviorTree {
  const snapshot = JSON.parse(JSON.stringify(tree)) as BehaviorTree;
  const remap = (value: BehaviorTree): BehaviorTree => ({
    ...value,
    id: createUuid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nodes: value.nodes.map(node => ({
      ...node,
      data: node.type === BehaviorNodeType.Subtree ? { ...node.data, tree: remap((node.data as any).tree) } : node.data,
    })),
  });
  return remap(snapshot);
}

export function serializeTree(tree: BehaviorTree): string {
  return JSON.stringify({ version: '1.0.0', tree: decodeTree(tree) }, null, 2);
}
