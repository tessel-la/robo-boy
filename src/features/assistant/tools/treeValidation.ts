import type { BehaviorTree } from '../../behaviorTree/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import type { BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import { validatePayload } from './payloadValidation';

/** Generated and stored graphs share the same structural invariants. A root elsewhere in
 * the graph must not hide a disconnected cycle, and malformed edges must not be dropped. */
export function validateTreeStructure(tree: BehaviorTree): string[] {
  const errors: string[] = [],
    ids = new Set<string>(),
    edges = new Map<string, string[]>();
  const allowed = new Set([
    'sequence',
    'selector',
    'parallel',
    'retry',
    'repeat',
    'timeout',
    'ifElse',
    'subtree',
    'condition',
    'action',
    'service',
    'topic',
    'subscriber',
  ]);
  if (!Array.isArray(tree.nodes) || !Array.isArray(tree.edges) || tree.nodes.length > 500 || tree.edges.length > 1000)
    return ['Invalid or oversized tree graph.'];
  for (const node of tree.nodes) {
    if (!node?.id || ids.has(node.id)) errors.push('Node ids must be unique.');
    ids.add(node.id);
    if (
      !allowed.has(String(node.type)) ||
      !node.data ||
      !Number.isFinite(node.position?.x) ||
      !Number.isFinite(node.position?.y)
    )
      errors.push(`Invalid node ${node.id}.`);
  }
  for (const edge of tree.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push('An edge references an unknown node.');
    edges.set(edge.source, [...(edges.get(edge.source) ?? []), edge.target]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const target of edges.get(id) ?? []) if (!visit(target)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if ([...ids].some(id => !visit(id))) errors.push('Behavior trees cannot contain cycles.');
  return errors;
}

export function validateTreeBindings(
  tree: BehaviorTree,
  graph: ROSDiscoveryResult | null,
  schemas: BehaviorTreeResourceSchemas
): string[] {
  const errors: string[] = [];
  const walk = (value: BehaviorTree, depth: number) => {
    if (depth > 10) {
      errors.push('Subtree nesting exceeds ten levels.');
      return;
    }
    errors.push(...validateTreeStructure(value));
    for (const node of value.nodes ?? []) {
      const data = node.data as unknown as Record<string, any>;
      if (!data) continue;
      const kind =
        node.type === 'action'
          ? 'action'
          : node.type === 'service'
            ? 'service'
            : ['topic', 'subscriber'].includes(String(node.type))
              ? 'topic'
              : null;
      if (kind) {
        const name = data[kind === 'action' ? 'actionName' : kind === 'service' ? 'serviceName' : 'topicName'];
        const type = data[kind === 'action' ? 'actionType' : kind === 'service' ? 'serviceType' : 'messageType'];
        const resources = graph?.[kind === 'action' ? 'actions' : kind === 'service' ? 'services' : 'topics'];
        if (!resources?.some(resource => resource.name === name && resource.type === type))
          errors.push(`${node.id}: retrieve the connected ${kind} interface for ${String(name)} before saving.`);
        if (kind !== 'topic') {
          const schema = schemas[kind === 'action' ? 'actions' : 'services'][type];
          if (!schema) errors.push(`${node.id}: read the ${kind} schema before saving its payload.`);
          else
            errors.push(
              ...validatePayload(data[kind === 'action' ? 'parameters' : 'request'] ?? {}, schema).map(
                error => `${node.id}: ${error}`
              )
            );
        }
      }
      if (node.type === 'subtree' && data.tree) walk(data.tree, depth + 1);
    }
  };
  walk(tree, 0);
  return errors.slice(0, 40);
}
