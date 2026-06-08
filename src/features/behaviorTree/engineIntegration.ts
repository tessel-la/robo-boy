import { Edge } from 'reactflow';
import { v4 as uuidv4 } from 'uuid';

import {
  BehaviorNodeData,
  BehaviorNodeType,
  BehaviorTree,
  BehaviorTreeEngine,
  BehaviorTreeEngineCapabilities,
  BehaviorTreeEngineConfig,
  BehaviorTreeNode,
  BehaviorTreeNodeTypeInfo,
  BehaviorTreeRuntimeTreeInfo,
  BehaviorTreeRuntimeNode,
  ControlFlowNodeData,
  ExecutionStatus,
  ROSActionNodeData,
} from './types';

export const DEFAULT_ENGINE_CONFIGS: Record<BehaviorTreeEngine, BehaviorTreeEngineConfig> = {
  [BehaviorTreeEngine.Local]: {
    engine: BehaviorTreeEngine.Local,
    namespace: '',
    capabilitiesTopic: '/behavior_tree/runtime/capabilities',
    treeCatalogTopic: '/behavior_tree/runtime/trees',
    catalogTopic: '/behavior_tree/runtime/nodes',
    specTopic: '/behavior_tree/spec',
    commandTopic: '/behavior_tree/runtime/command',
    statusTopic: '/behavior_tree/status',
    treeTopic: '/behavior_tree/tree',
  },
  [BehaviorTreeEngine.PyTrees]: {
    engine: BehaviorTreeEngine.PyTrees,
    namespace: '',
    capabilitiesTopic: '/behavior_tree/runtime/capabilities',
    treeCatalogTopic: '/behavior_tree/runtime/trees',
    catalogTopic: '/behavior_tree/runtime/nodes',
    specTopic: '/behavior_tree/runtime/spec',
    commandTopic: '/behavior_tree/runtime/command',
    statusTopic: '/behavior_tree/runtime/status',
    treeTopic: '/behavior_tree/runtime/tree',
  },
  [BehaviorTreeEngine.BehaviorTreeCpp]: {
    engine: BehaviorTreeEngine.BehaviorTreeCpp,
    namespace: '',
    capabilitiesTopic: '/behavior_tree/runtime/capabilities',
    treeCatalogTopic: '/behavior_tree/runtime/trees',
    catalogTopic: '/behavior_tree/runtime/nodes',
    specTopic: '/behavior_tree/runtime/spec',
    commandTopic: '/behavior_tree/runtime/command',
    statusTopic: '/behavior_tree/runtime/status',
    treeTopic: '/behavior_tree/runtime/tree',
  },
};

export const DEFAULT_NODE_TYPES: BehaviorTreeNodeTypeInfo[] = [
  { id: 'sequence', label: 'Sequence', category: 'control', minChildren: 1 },
  { id: 'selector', label: 'Selector', category: 'control', minChildren: 1 },
  { id: 'parallel', label: 'Parallel', category: 'control', minChildren: 1 },
];

interface BehaviorNodeSpec {
  kind: string;
  name: string;
  params: Record<string, any>;
  children: BehaviorNodeSpec[];
}

const COMPOSITE_KINDS = new Set(['sequence', 'selector', 'parallel']);

const XML_TAGS: Record<string, string> = {
  sequence: 'Sequence',
  selector: 'Fallback',
  parallel: 'Parallel',
  action: 'RosAction',
  service: 'RosService',
  topic: 'RosTopic',
  condition: 'Condition',
};

const XML_KINDS: Record<string, string> = Object.fromEntries(
  Object.entries(XML_TAGS).map(([kind, tag]) => [tag.toLowerCase(), kind])
);

const isBehaviorTreeEngine = (value: unknown): value is BehaviorTreeEngine =>
  Object.values(BehaviorTreeEngine).includes(value as BehaviorTreeEngine);

export const getEngineConfig = (tree: BehaviorTree | null): BehaviorTreeEngineConfig => {
  const candidate = tree?.engine ?? tree?.engineConfig?.engine ?? BehaviorTreeEngine.Local;
  const engine = isBehaviorTreeEngine(candidate) ? candidate : BehaviorTreeEngine.Local;
  return {
    ...DEFAULT_ENGINE_CONFIGS[engine],
    ...tree?.engineConfig,
    engine,
  };
};

const sortEdgesForParent = (edges: Edge[], parentId: string): Edge[] =>
  edges
    .filter((edge) => edge.source === parentId)
    .sort((a, b) => {
      const aOrder = typeof a.data?.order === 'number' ? a.data.order : Number.MAX_SAFE_INTEGER;
      const bOrder = typeof b.data?.order === 'number' ? b.data.order : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return edges.indexOf(a) - edges.indexOf(b);
    });

const findRootNode = (nodes: BehaviorTreeNode[], edges: Edge[]): BehaviorTreeNode | null => {
  const targets = new Set(edges.map((edge) => edge.target));
  return nodes.find((node) => !targets.has(node.id)) ?? nodes[0] ?? null;
};

const basename = (value: string): string => value.split('/').filter(Boolean).pop() ?? value;

const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

const toPascalCase = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

const tagForKind = (kind: string): string => XML_TAGS[kind] ?? toPascalCase(kind) ?? 'Action';

const getNodeKind = (node: BehaviorTreeNode): string => {
  if (node.data.externalKind) return node.data.externalKind;
  if (node.type === BehaviorNodeType.Sequence) return 'sequence';
  if (node.type === BehaviorNodeType.Selector) return 'selector';
  if (node.type === BehaviorNodeType.Parallel) return 'parallel';
  if (node.type === BehaviorNodeType.Service) return 'service';
  if (node.type === BehaviorNodeType.Topic) return 'topic';
  if (node.type === BehaviorNodeType.Condition) return 'condition';

  if (node.type === BehaviorNodeType.Action && 'actionName' in node.data) {
    return toSnakeCase(basename(node.data.actionName)) || 'action';
  }

  return 'action';
};

const cloneParams = (value?: Record<string, any>): Record<string, any> =>
  value ? JSON.parse(JSON.stringify(value)) : {};

const getNodeParams = (node: BehaviorTreeNode): Record<string, any> => {
  const data = node.data;
  const params = cloneParams(data.externalParams);

  if ('actionName' in data) {
    if (!data.externalKind) {
      params.action_name = data.actionName;
      params.action_type = data.actionType;
    }
    Object.assign(params, data.parameters ?? {});
  } else if ('serviceName' in data) {
    params.service_name = data.serviceName;
    params.service_type = data.serviceType;
    Object.assign(params, data.request ?? {});
  } else if ('topicName' in data) {
    params.topic_name = data.topicName;
    params.message_type = data.messageType;
    Object.assign(params, data.message ?? {});
  } else if ('condition' in data) {
    params.condition = data.condition;
    params.operator = data.operator;
    params.expected_value = data.expectedValue;
  } else if ('description' in data && data.description) {
    params.description = data.description;
  }

  Object.keys(params).forEach((key) => {
    if (params[key] === undefined || params[key] === '') delete params[key];
  });

  return params;
};

const treeToSpec = (tree: BehaviorTree): BehaviorNodeSpec | null => {
  const nodesById = new Map(tree.nodes.map((node) => [node.id, node]));
  const root = findRootNode(tree.nodes, tree.edges);
  if (!root) return null;

  const visit = (node: BehaviorTreeNode): BehaviorNodeSpec => {
    const kind = getNodeKind(node);
    const children = sortEdgesForParent(tree.edges, node.id)
      .map((edge) => nodesById.get(edge.target))
      .filter((child): child is BehaviorTreeNode => Boolean(child))
      .map(visit);

    return {
      kind,
      name: node.data.label || node.id,
      params: getNodeParams(node),
      children,
    };
  };

  return visit(root);
};

const yamlScalar = (value: any): string => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  const str = String(value);
  if (/^[A-Za-z0-9_./:-]+$/.test(str)) return str;
  return JSON.stringify(str);
};

const appendYamlParams = (lines: string[], params: Record<string, any>, indent: number) => {
  Object.entries(params).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${' '.repeat(indent)}${key}:`);
      appendYamlParams(lines, value, indent + 2);
    } else {
      lines.push(`${' '.repeat(indent)}${key}: ${yamlScalar(value)}`);
    }
  });
};

const appendYamlNode = (lines: string[], node: BehaviorNodeSpec, indent: number, listItem = false) => {
  const prefix = `${' '.repeat(indent)}${listItem ? '- ' : ''}`;
  lines.push(`${prefix}${node.kind}:`);
  const paramIndent = indent + (listItem ? 4 : 2);
  lines.push(`${' '.repeat(paramIndent)}name: ${yamlScalar(node.name)}`);
  appendYamlParams(lines, node.params, paramIndent);
  if (node.children.length > 0) {
    lines.push(`${' '.repeat(paramIndent)}children:`);
    node.children.forEach((child) => appendYamlNode(lines, child, paramIndent + 2, true));
  }
};

export const exportTreeAsYaml = (tree: BehaviorTree): string => {
  const root = treeToSpec(tree);
  const engine = tree.engine === BehaviorTreeEngine.BehaviorTreeCpp
    ? BehaviorTreeEngine.BehaviorTreeCpp
    : BehaviorTreeEngine.PyTrees;
  const lines = [
    `name: ${yamlScalar(tree.name || 'behavior_tree')}`,
    `backend: ${engine}`,
    'root:',
  ];

  if (root) {
    appendYamlNode(lines, root, 2);
  }

  return `${lines.join('\n')}\n`;
};

const xmlEscape = (value: any): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const appendXmlNode = (lines: string[], node: BehaviorNodeSpec, indent: number) => {
  const tag = tagForKind(node.kind);
  const attrs = { name: node.name, ...node.params };
  const attrText = Object.entries(attrs)
    .map(([key, value]) => `${key}="${xmlEscape(value)}"`)
    .join(' ');
  const pad = ' '.repeat(indent);

  if (node.children.length === 0) {
    lines.push(`${pad}<${tag} ${attrText} />`);
    return;
  }

  lines.push(`${pad}<${tag} ${attrText}>`);
  node.children.forEach((child) => appendXmlNode(lines, child, indent + 2));
  lines.push(`${pad}</${tag}>`);
};

export const exportTreeAsBtCppXml = (tree: BehaviorTree): string => {
  const root = treeToSpec(tree);
  const treeName = tree.name || 'MainTree';
  const lines = [
    '<root BTCPP_format="4">',
    `  <BehaviorTree ID="${xmlEscape(treeName)}">`,
  ];
  if (root) appendXmlNode(lines, root, 4);
  lines.push('  </BehaviorTree>');
  lines.push('</root>');
  return `${lines.join('\n')}\n`;
};

const parseScalar = (value: string): any => {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

const lineIndent = (line: string): number => line.match(/^ */)?.[0].length ?? 0;

const cleanYamlLines = (content: string): string[] =>
  content
    .replace(/\t/g, '  ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, '').replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0);

const parseYamlNode = (
  lines: string[],
  startIndex: number,
  fallbackName?: string
): { node: BehaviorNodeSpec; nextIndex: number } => {
  const first = lines[startIndex];
  const indent = lineIndent(first);
  const trimmed = first.trim();
  const match = trimmed.match(/^-?\s*([A-Za-z_][\w-]*):\s*$/);
  if (!match) throw new Error(`Invalid behavior tree node line: ${trimmed}`);

  const isListItem = trimmed.startsWith('-');
  const kind = match[1];
  const paramIndent = indent + (isListItem ? 4 : 2);
  const params: Record<string, any> = {};
  const children: BehaviorNodeSpec[] = [];
  let name = fallbackName ?? kind;
  let index = startIndex + 1;

  while (index < lines.length) {
    const current = lines[index];
    const currentIndent = lineIndent(current);
    if (currentIndent <= indent) break;
    const currentTrimmed = current.trim();

    if (currentIndent === paramIndent && currentTrimmed === 'children:') {
      index += 1;
      while (index < lines.length && lineIndent(lines[index]) > paramIndent) {
        const parsed = parseYamlNode(lines, index);
        children.push(parsed.node);
        index = parsed.nextIndex;
      }
      continue;
    }

    const paramMatch = currentTrimmed.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (currentIndent === paramIndent && paramMatch) {
      const key = paramMatch[1];
      const value = parseScalar(paramMatch[2]);
      if (key === 'name' && typeof value === 'string') {
        name = value;
      } else {
        params[key] = value;
      }
    }
    index += 1;
  }

  return { node: { kind, name, params, children }, nextIndex: index };
};

const yamlNodeKind = (line: string): string | null =>
  line.trim().match(/^-?\s*([A-Za-z_][\w-]*):\s*$/)?.[1] ?? null;

const nodeTypeFromKind = (kind: string): BehaviorNodeType => {
  if (kind === 'sequence') return BehaviorNodeType.Sequence;
  if (kind === 'selector') return BehaviorNodeType.Selector;
  if (kind === 'parallel') return BehaviorNodeType.Parallel;
  if (kind === 'service') return BehaviorNodeType.Service;
  if (kind === 'topic') return BehaviorNodeType.Topic;
  return BehaviorNodeType.Action;
};

const createNodeDataFromSpec = (spec: BehaviorNodeSpec, nodeType: BehaviorNodeType): BehaviorNodeData => {
  if (COMPOSITE_KINDS.has(spec.kind)) {
    return {
      label: spec.name,
      type: spec.kind as ControlFlowNodeData['type'],
      externalKind: spec.kind,
      externalParams: spec.params,
      description: spec.params.memory !== undefined ? `memory: ${spec.params.memory}` : undefined,
    } as ControlFlowNodeData;
  }

  if (nodeType === BehaviorNodeType.Service) {
    return {
      label: spec.name,
      serviceName: spec.params.service_name ?? spec.kind,
      serviceType: spec.params.service_type ?? '',
      request: spec.params,
      externalKind: spec.kind,
      externalParams: spec.params,
    };
  }

  if (nodeType === BehaviorNodeType.Topic) {
    return {
      label: spec.name,
      topicName: spec.params.topic_name ?? spec.kind,
      messageType: spec.params.message_type ?? '',
      message: spec.params,
      externalKind: spec.kind,
      externalParams: spec.params,
    };
  }

  return {
    label: spec.name,
    actionName: spec.params.action_name ?? spec.kind,
    actionType: spec.params.action_type ?? '',
    parameters: spec.params,
    externalKind: spec.kind,
    externalParams: spec.params,
  } as ROSActionNodeData;
};

const specToTree = (
  name: string,
  engine: BehaviorTreeEngine,
  root: BehaviorNodeSpec
): BehaviorTree => {
  const nodes: BehaviorTreeNode[] = [];
  const edges: Edge[] = [];
  let nodeIndex = 0;
  let edgeIndex = 0;
  const leafRowsByDepth = new Map<number, number>();

  const visit = (spec: BehaviorNodeSpec, depth: number, parentId?: string): string => {
    const id = `node-${nodeIndex}`;
    nodeIndex += 1;
    const sibling = leafRowsByDepth.get(depth) ?? 0;
    leafRowsByDepth.set(depth, sibling + 1);
    const nodeType = nodeTypeFromKind(spec.kind);
    nodes.push({
      id,
      type: nodeType,
      position: { x: depth * 250, y: sibling * 130 },
      data: createNodeDataFromSpec(spec, nodeType),
    });

    if (parentId) {
      edges.push({ id: `edge-${edgeIndex}`, source: parentId, target: id, sourceHandle: null, targetHandle: null });
      edgeIndex += 1;
    }

    spec.children.forEach((child) => visit(child, depth + 1, id));
    return id;
  };

  visit(root, 0);
  const now = Date.now();
  return {
    id: uuidv4(),
    name,
    engine,
    engineConfig: { engine },
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
};

export const importTreeFromYaml = (content: string): BehaviorTree => {
  const lines = cleanYamlLines(content);
  const nameLine = lines.find((line) => line.startsWith('name:'));
  const backendLine = lines.find((line) => line.startsWith('backend:'));
  const rootIndex = lines.findIndex((line) => line.trim() === 'root:');
  const stepsIndex = lines.findIndex((line) => line.trim() === 'steps:');

  const name = nameLine ? String(parseScalar(nameLine.slice(5))) : 'Imported Behavior Tree';
  const backend = backendLine ? String(parseScalar(backendLine.slice(8))) : BehaviorTreeEngine.PyTrees;
  const engine = backend === BehaviorTreeEngine.BehaviorTreeCpp
    ? BehaviorTreeEngine.BehaviorTreeCpp
    : BehaviorTreeEngine.PyTrees;

  if (rootIndex < 0) {
    const startIndex = stepsIndex >= 0 ? stepsIndex + 1 : 0;
    const children: BehaviorNodeSpec[] = [];
    let index = startIndex;
    while (index < lines.length) {
      const kind = yamlNodeKind(lines[index]);
      if (!kind) {
        index += 1;
        continue;
      }
      const parsed = parseYamlNode(lines, index, `${children.length + 1}_${kind}`);
      children.push(parsed.node);
      index = parsed.nextIndex;
    }
    if (children.length === 0) {
      throw new Error('Behavior tree YAML needs a root node');
    }
    return specToTree(name, engine, {
      kind: 'sequence',
      name,
      params: { memory: true },
      children,
    });
  }

  if (rootIndex + 1 >= lines.length) {
    throw new Error('Behavior tree YAML needs a root node');
  }

  const parsed = parseYamlNode(lines, rootIndex + 1);
  return specToTree(name, engine, parsed.node);
};

const specFromXmlElement = (element: Element): BehaviorNodeSpec => {
  const tag = element.tagName.toLowerCase();
  const kind = XML_KINDS[tag] ?? toSnakeCase(element.tagName);
  const params: Record<string, any> = {};
  let name = element.getAttribute('name') ?? kind;

  Array.from(element.attributes).forEach((attribute) => {
    if (attribute.name === 'name') return;
    params[attribute.name] = parseScalar(attribute.value);
  });

  const children = Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() !== 'treenodesmodel')
    .map(specFromXmlElement);

  if (!element.getAttribute('name') && children.length > 0) {
    name = kind;
  }

  return { kind, name, params, children };
};

export const importTreeFromBtCppXml = (content: string): BehaviorTree => {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.querySelector('parsererror')) {
    throw new Error('Invalid BehaviorTree.CPP XML');
  }

  const treeElement = document.querySelector('BehaviorTree');
  const rootNodeElement = treeElement?.children[0];
  if (!treeElement || !rootNodeElement) {
    throw new Error('BehaviorTree.CPP XML needs a BehaviorTree root');
  }

  const name = treeElement.getAttribute('ID') ?? 'Imported BT.CPP Tree';
  return specToTree(name, BehaviorTreeEngine.BehaviorTreeCpp, specFromXmlElement(rootNodeElement));
};

export const importTreeFromText = (content: string, fileName = ''): BehaviorTree => {
  const trimmed = content.trim();
  if (fileName.endsWith('.xml') || trimmed.startsWith('<')) {
    return importTreeFromBtCppXml(trimmed);
  }
  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml') || trimmed.includes('root:')) {
    return importTreeFromYaml(trimmed);
  }
  const saved = JSON.parse(trimmed);
  const tree = saved.tree ?? saved;
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.nodes)) {
    throw new Error('Behavior tree JSON needs a nodes array');
  }
  return {
    ...tree,
    edges: Array.isArray(tree.edges) ? tree.edges : [],
  };
};

const normalizeStatus = (value: any): ExecutionStatus | null => {
  const status = String(value ?? '').toLowerCase();
  if (status.includes('running')) return ExecutionStatus.Running;
  if (status.includes('success') || status === 'succeeded') return ExecutionStatus.Success;
  if (status.includes('failure') || status.includes('failed')) return ExecutionStatus.Failure;
  if (status.includes('idle') || status.includes('invalid')) return ExecutionStatus.Idle;
  return null;
};

const parseJsonStatus = (message: any): Map<string, ExecutionStatus> => {
  const statuses = new Map<string, ExecutionStatus>();
  const data = typeof message === 'string' ? JSON.parse(message) : message;
  const entries = Array.isArray(data?.statuses)
    ? data.statuses
    : Array.isArray(data?.nodes)
      ? data.nodes
      : data?.nodes && typeof data.nodes === 'object'
        ? Object.entries(data.nodes).map(([id, status]) => ({ id, status }))
        : data && typeof data === 'object'
          ? Object.entries(data).map(([id, status]) => ({ id, status }))
          : [];

  entries.forEach((entry: any) => {
    const id = entry.id ?? entry.uid ?? entry.name ?? entry.label;
    const status = normalizeStatus(entry.status ?? entry.state ?? entry[1]);
    if (id && status) statuses.set(String(id), status);
  });

  return statuses;
};

const runtimeStatusKeysForNode = (node: BehaviorTreeNode): string[] => {
  const data = node.data;
  return [
    node.id,
    data.label,
    data.externalKind,
    'actionName' in data ? data.actionName : undefined,
    'serviceName' in data ? data.serviceName : undefined,
    'topicName' in data ? data.topicName : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
};

const mapRuntimeStatusesToGraphNodes = (
  statuses: Map<string, ExecutionStatus>,
  nodes: BehaviorTreeNode[]
): Map<string, ExecutionStatus> => {
  if (statuses.size === 0 || nodes.length === 0) return statuses;

  const mapped = new Map(statuses);
  const runtimeEntries = Array.from(statuses.entries()).map(([id, status]) => ({
    id,
    key: id.toLowerCase(),
    tail: id.split('/').filter(Boolean).pop()?.toLowerCase() ?? id.toLowerCase(),
    status,
  }));

  nodes.forEach((node) => {
    if (mapped.has(node.id)) return;
    const graphKeys = runtimeStatusKeysForNode(node);
    const match = runtimeEntries.find((entry) =>
      graphKeys.some((key) => entry.key === key || entry.tail === key || entry.key.endsWith(`/${key}`))
    );
    if (match) mapped.set(node.id, match.status);
  });

  return mapped;
};

export const parseRuntimeStatusMessage = (
  message: any,
  nodes: BehaviorTreeNode[]
): Map<string, ExecutionStatus> => {
  const raw = typeof message?.data === 'string' ? message.data : message;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const jsonStatuses = parseJsonStatus(trimmed);
        if (jsonStatuses.size > 0) return mapRuntimeStatusesToGraphNodes(jsonStatuses, nodes);
      } catch {
        // Fall through to ascii parsing.
      }
    }

    const statuses = new Map<string, ExecutionStatus>();
    const lines = trimmed.split(/\r?\n/);
    nodes.forEach((node) => {
      const names = [
        node.id,
        node.data.label,
        node.data.externalKind,
        'actionName' in node.data ? node.data.actionName : undefined,
        'serviceName' in node.data ? node.data.serviceName : undefined,
        'topicName' in node.data ? node.data.topicName : undefined,
      ].filter((value): value is string => Boolean(value));

      const line = lines.find((candidate) => names.some((name) => candidate.includes(name)));
      if (!line) return;
      const status = normalizeStatus(line);
      if (status) statuses.set(node.id, status);
    });
    return statuses;
  }

  return mapRuntimeStatusesToGraphNodes(parseJsonStatus(raw), nodes);
};

const rawRuntimePayload = (message: any): any => {
  if (typeof message?.data === 'string') return message.data;
  return message;
};

const runtimeStatusFromValue = (value: any): ExecutionStatus | undefined =>
  normalizeStatus(value) ?? undefined;

const parseJsonRuntimeNodes = (data: any, source: string): BehaviorTreeRuntimeNode[] => {
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  const trees = Array.isArray(payload?.trees) ? payload.trees : [];
  const rootNodes = Array.isArray(payload?.nodes)
    ? payload.nodes
    : payload?.nodes && typeof payload.nodes === 'object'
      ? Object.entries(payload.nodes).map(([id, value]) => (
        typeof value === 'object' && value !== null ? { id, ...value } : { id, name: id, status: value }
      ))
      : Array.isArray(payload)
        ? payload
        : [];

  const nodes: BehaviorTreeRuntimeNode[] = [];
  const pushNode = (entry: any, index: number, treeId?: string) => {
    const id = String(entry.id ?? entry.uid ?? entry.name ?? entry.label ?? `${source}-${index}`);
    const name = String(entry.name ?? entry.label ?? entry.id ?? id);
    nodes.push({
      id,
      name,
      type: entry.type ?? entry.kind ?? entry.node_type,
      status: runtimeStatusFromValue(entry.status ?? entry.state),
      treeId: entry.treeId ?? entry.tree_id ?? treeId,
      path: entry.path,
      parentId: entry.parentId ?? entry.parent_id,
      source,
      raw: entry,
    });
  };

  rootNodes.forEach((entry: any, index: number) => pushNode(entry, index, payload?.treeId ?? payload?.tree_id));
  trees.forEach((tree: any, treeIndex: number) => {
    const treeId = String(tree.id ?? tree.name ?? `tree-${treeIndex}`);
    if (Array.isArray(tree.nodes)) {
      tree.nodes.forEach((entry: any, index: number) => pushNode(entry, index, treeId));
    }
  });

  return nodes;
};

const flattenSpecRuntimeNodes = (
  spec: BehaviorNodeSpec,
  source: string,
  treeId: string,
  parentId?: string,
  path: string[] = [],
  nodes: BehaviorTreeRuntimeNode[] = []
): BehaviorTreeRuntimeNode[] => {
  const id = [...path, spec.name].join('/') || spec.name;
  nodes.push({
    id,
    name: spec.name,
    type: spec.kind,
    treeId,
    parentId,
    path: id,
    source,
  });
  spec.children.forEach((child) =>
    flattenSpecRuntimeNodes(child, source, treeId, id, [...path, spec.name], nodes)
  );
  return nodes;
};

const parseXmlRuntimeNodes = (content: string, source: string): BehaviorTreeRuntimeNode[] => {
  const document = new DOMParser().parseFromString(content, 'application/xml');
  if (document.querySelector('parsererror')) return [];
  const treeElement = document.querySelector('BehaviorTree');
  const rootNodeElement = treeElement?.children[0];
  if (!treeElement || !rootNodeElement) return [];
  const treeId = treeElement.getAttribute('ID') ?? 'runtime_tree';
  return flattenSpecRuntimeNodes(specFromXmlElement(rootNodeElement), source, treeId);
};

const parseYamlRuntimeNodes = (content: string, source: string): BehaviorTreeRuntimeNode[] => {
  try {
    const tree = importTreeFromYaml(content);
    return tree.nodes.map((node) => ({
      id: node.id,
      name: node.data.label || node.id,
      type: node.data.externalKind ?? node.type ?? undefined,
      status: node.data.status,
      treeId: tree.name,
      source,
    }));
  } catch {
    return [];
  }
};

const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '');

const asciiNodeName = (line: string): string => {
  return stripAnsi(line)
    .replace(/\[[^\]]*(SUCCESS|FAILURE|RUNNING|INVALID|IDLE)[^\]]*\]/gi, '')
    .replace(/\b(SUCCESS|FAILURE|RUNNING|INVALID|IDLE)\b/gi, '')
    .replace(/^[\s│├└─+`'*|\\/<>{}\[\]oOxX?\-^~→✓✕.]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseAsciiRuntimeNodes = (content: string, source: string): BehaviorTreeRuntimeNode[] => {
  const nodes: BehaviorTreeRuntimeNode[] = [];
  const parentStack: Array<{ depth: number; id: string }> = [];
  stripAnsi(content).split(/\r?\n/).forEach((line, index) => {
    const name = asciiNodeName(line);
    if (!name || name.length > 120) return;
    const indent = lineIndent(line);
    const depth = Math.max(0, Math.floor(indent / 2));
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].depth >= depth) {
      parentStack.pop();
    }
    const parentId = parentStack[parentStack.length - 1]?.id;
    const id = `${source}-${index}-${toSnakeCase(name) || 'node'}`;
    nodes.push({
      id,
      name,
      status: runtimeStatusFromValue(line),
      parentId,
      path: parentId ? `${parentId}/${name}` : name,
      source,
    });
    parentStack.push({ depth, id });
  });
  return nodes;
};

export const parseRuntimeNodeCatalogMessage = (
  message: any,
  source = 'runtime'
): BehaviorTreeRuntimeNode[] => {
  const raw = rawRuntimePayload(message);
  if (typeof raw !== 'string') {
    return parseJsonRuntimeNodes(raw, source);
  }

  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseJsonRuntimeNodes(trimmed, source);
    } catch {
      return [];
    }
  }
  if (trimmed.startsWith('<')) return parseXmlRuntimeNodes(trimmed, source);
  if (trimmed.includes('root:')) return parseYamlRuntimeNodes(trimmed, source);
  return parseAsciiRuntimeNodes(trimmed, source);
};

export const parseEngineCapabilitiesMessage = (message: any): BehaviorTreeEngineCapabilities | null => {
  const raw = rawRuntimePayload(message);
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!payload || typeof payload !== 'object') return null;
    const nodeTypes = Array.isArray(payload.nodeTypes)
      ? payload.nodeTypes
      : Array.isArray(payload.node_types)
        ? payload.node_types
        : [];

    return {
      engine: payload.engine ?? 'unknown',
      nodeTypes: nodeTypes.map((nodeType: any): BehaviorTreeNodeTypeInfo => ({
        id: String(nodeType.id ?? nodeType.kind ?? nodeType.name),
        label: String(nodeType.label ?? nodeType.name ?? nodeType.id ?? nodeType.kind),
        category: nodeType.category ?? 'action',
        description: nodeType.description,
        params: Array.isArray(nodeType.params) ? nodeType.params : [],
        minChildren: nodeType.minChildren ?? nodeType.min_children,
        maxChildren: nodeType.maxChildren ?? nodeType.max_children,
      })),
      trees: Array.isArray(payload.trees) ? payload.trees : [],
      constraints: Array.isArray(payload.constraints) ? payload.constraints : [],
    };
  } catch {
    return null;
  }
};

export const parseRuntimeTreeCatalogMessage = (message: any): BehaviorTreeRuntimeTreeInfo[] => {
  const raw = rawRuntimePayload(message);
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const trees = Array.isArray(payload?.trees) ? payload.trees : Array.isArray(payload) ? payload : [];
    return trees
      .filter((tree: any) => tree?.id !== undefined || tree?.name !== undefined)
      .map((tree: any): BehaviorTreeRuntimeTreeInfo => ({
        id: String(tree.id ?? tree.name),
        name: String(tree.name ?? tree.id),
        engine: tree.engine,
        format: tree.format,
        spec: tree.spec,
        description: tree.description,
      }));
  } catch {
    return [];
  }
};

export const createNodeDataFromEngineType = (
  nodeType: BehaviorTreeNodeTypeInfo
): BehaviorNodeData => {
  const defaults = Object.fromEntries(
    (nodeType.params ?? [])
      .filter((param) => param.default !== undefined)
      .map((param) => [param.name, param.default])
  );

  if (nodeType.id === 'sequence' || nodeType.id === 'selector' || nodeType.id === 'parallel') {
    return {
      label: nodeType.label,
      type: nodeType.id,
      externalKind: nodeType.id,
      externalParams: defaults,
      description: nodeType.description,
    } as ControlFlowNodeData;
  }

  return {
    label: nodeType.label,
    actionName: nodeType.id,
    actionType: nodeType.id,
    parameters: defaults,
    externalKind: nodeType.id,
    externalParams: defaults,
  } as ROSActionNodeData;
};

export const behaviorNodeTypeFromEngineType = (nodeType: BehaviorTreeNodeTypeInfo): BehaviorNodeType => {
  if (nodeType.id === 'sequence') return BehaviorNodeType.Sequence;
  if (nodeType.id === 'selector') return BehaviorNodeType.Selector;
  if (nodeType.id === 'parallel') return BehaviorNodeType.Parallel;
  return BehaviorNodeType.Action;
};

export const validateBehaviorTreeForEngine = (
  tree: BehaviorTree,
  nodeTypes: BehaviorTreeNodeTypeInfo[] = DEFAULT_NODE_TYPES
): string[] => {
  const errors: string[] = [];
  const nodeTypeMap = new Map(nodeTypes.map((nodeType) => [nodeType.id, nodeType]));
  const targets = new Set(tree.edges.map((edge) => edge.target));
  const roots = tree.nodes.filter((node) => !targets.has(node.id));
  if (tree.nodes.length === 0) {
    errors.push('Tree has no nodes');
    return errors;
  }
  if (roots.length !== 1) {
    errors.push(`Tree must have exactly one root; found ${roots.length}`);
  }

  tree.nodes.forEach((node) => {
    const kind = getNodeKind(node);
    const nodeType = nodeTypeMap.get(kind);
    const childCount = tree.edges.filter((edge) => edge.source === node.id).length;
    if (nodeType?.minChildren !== undefined && childCount < nodeType.minChildren) {
      errors.push(`${node.data.label || node.id} needs at least ${nodeType.minChildren} child node(s)`);
    }
    if (nodeType?.maxChildren !== undefined && childCount > nodeType.maxChildren) {
      errors.push(`${node.data.label || node.id} allows at most ${nodeType.maxChildren} child node(s)`);
    }
    (nodeType?.params ?? []).forEach((param) => {
      if (!param.required) return;
      const params = getNodeParams(node);
      if (params[param.name] === undefined || params[param.name] === '') {
        errors.push(`${node.data.label || node.id} is missing required parameter ${param.name}`);
      }
    });
  });

  return errors;
};

export const downloadTextFile = (content: string, fileName: string, type: string): void => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
