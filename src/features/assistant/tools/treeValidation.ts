import type { BehaviorTree } from '../../behaviorTree/types';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';
import type { BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';
import { validatePayload } from './payloadValidation';

import { validateTreeStructure } from '../../behaviorTree/validation';
export { validateTreeStructure } from '../../behaviorTree/validation';

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
