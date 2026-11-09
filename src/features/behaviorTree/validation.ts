import { BehaviorNodeType, type BehaviorTree } from './types';

/** Generated and stored graphs share the same structural invariants. A root elsewhere in
 * the graph must not hide a disconnected cycle, and malformed edges must not be dropped. */
export function validateTreeStructure(tree: BehaviorTree): string[] {
  const errors: string[] = [],
    ids = new Set<string>(),
    edges = new Map<string, string[]>();
  const allowed = new Set<string>(Object.values(BehaviorNodeType));
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
