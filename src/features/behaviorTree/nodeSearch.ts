import { BehaviorNodeType, BehaviorTreeNode } from './types';

export interface BehaviorNodeSearchResult {
  node: BehaviorTreeNode;
  label: string;
  detail?: string;
  typeLabel: string;
}

const NODE_TYPE_LABELS: Partial<Record<BehaviorNodeType, string>> = {
  [BehaviorNodeType.Sequence]: 'Sequence',
  [BehaviorNodeType.Selector]: 'Selector',
  [BehaviorNodeType.Parallel]: 'Parallel',
  [BehaviorNodeType.Subtree]: 'Subtree',
  [BehaviorNodeType.Action]: 'Action',
  [BehaviorNodeType.Service]: 'Service',
  [BehaviorNodeType.Topic]: 'Topic',
  [BehaviorNodeType.Condition]: 'Condition',
};

const getNodeDetail = (node: BehaviorTreeNode): string | undefined => {
  const { data } = node;

  if ('actionName' in data) return data.actionName;
  if ('serviceName' in data) return data.serviceName;
  if ('topicName' in data) return data.topicName;
  if ('description' in data) return data.description;
  if ('condition' in data) return data.condition;

  return undefined;
};

const getSearchableValues = (node: BehaviorTreeNode): string[] => {
  const { data } = node;
  const values = [node.id, node.type, data.label, getNodeDetail(node)];

  if ('actionType' in data) values.push(data.actionType);
  if ('serviceType' in data) values.push(data.serviceType);
  if ('messageType' in data) values.push(data.messageType);

  return values.filter((value): value is string => Boolean(value));
};

export const getBehaviorNodeTypeLabel = (node: BehaviorTreeNode): string => {
  const nodeType = node.type as BehaviorNodeType | undefined;
  return (nodeType && NODE_TYPE_LABELS[nodeType]) || 'Node';
};

export const searchBehaviorTreeNodes = (nodes: BehaviorTreeNode[], query: string): BehaviorNodeSearchResult[] => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return nodes.flatMap(node => {
    const haystack = getSearchableValues(node).join(' ').toLocaleLowerCase();
    if (!terms.every(term => haystack.includes(term))) return [];

    return [
      {
        node,
        label: node.data.label || node.id,
        detail: getNodeDetail(node),
        typeLabel: getBehaviorNodeTypeLabel(node),
      },
    ];
  });
};
