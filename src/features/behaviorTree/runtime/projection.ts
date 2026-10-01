import type { RuntimeNode, TreeRuntimeId } from './types';
import { inspectXml, treeFormats } from './xml';

export interface SourceNode extends RuntimeNode {
  attributes: Record<string, string>;
  subtreeId?: string;
  /** Instance address, independent of native UID, names and tick state. */
  subtreeView?: string;
  runtimeId?: string;
  editId?: string;
  childOrder?: number;
  childrenPolicy?: 'none' | 'one' | 'many' | 'host';
  position?: { x: number; y: number };
}
interface InstanceNode {
  source: SourceNode;
  children: InstanceNode[];
}
interface TreeView {
  treeId: string;
  parent?: string;
  nodes: SourceNode[];
}

/** Project definitions once; each SubTree occurrence owns a separate navigable view. */
export function projectXml(xml: string, runtime: TreeRuntimeId | null, treeId?: string, addresses?: Map<string, string>) {
  const inspected = inspectXml(xml, runtime, treeId);
  const definitions = new Map(inspected.trees.map(tree => [tree.getAttribute('ID')!, tree.children[0]]));
  const views = new Map<string, TreeView>();
  const buildView = (id: string, path: string, parent?: string): InstanceNode => {
    const view: TreeView = { treeId: id, parent, nodes: [] };
    views.set(path, view);
    const walk = (element: Element, nodePath: string, parentId: string | null): InstanceNode => {
      const editId = addresses?.get(`${id}:${nodePath}`);
      const address = editId ? `${path}/${editId}` : `${path}/${nodePath}`;
      const subtree = ['subtree', 'subtreeplus'].includes(element.tagName.toLowerCase());
      const source: SourceNode = {
        id: address,
        editId,
        parentId,
        label: element.getAttribute('name') || element.getAttribute('ID') || element.tagName,
        type: element.tagName,
        status: 'idle',
        nativeStatus: 'IDLE',
        feedback: '',
        attributes: Object.fromEntries(Array.from(element.attributes).map(a => [a.name, a.value])),
        ...(subtree ? { subtreeId: element.getAttribute('ID')!, subtreeView: address } : {}),
      };
      view.nodes.push(source);
      return {
        source,
        children: subtree
          ? [buildView(source.subtreeId!, address, path)]
          : Array.from(element.children).map((child, index) => walk(child, `${nodePath}/${index}`, address)),
      };
    };
    return walk(definitions.get(id)!, '0', null);
  };
  const root = inspected.mainTreeId ? buildView(inspected.mainTreeId, 'main') : null;
  return { ...inspected, root, views, nodes: views.get('main')?.nodes || [] };
}

/**
 * Both workers publish native children in definition order. Zip their topology with
 * the exact loaded XML, accounting for the format adapter's subtree boundaries.
 * Python's SubTree aliases its instantiated root; C++ retains a native wrapper.
 * Never guess by labels (which are neither unique nor stable in py_trees).
 */
export function bindRuntimeProjection(projection: ReturnType<typeof projectXml>, nodes: RuntimeNode[]) {
  const bindings = new Map<string, RuntimeNode>();
  if (!projection.root || !nodes.length || !projection.runtime) return { bindings, error: null };
  const adapter = treeFormats.find(format => format.id === projection.runtime)!;
  const children = new Map<string | null, RuntimeNode[]>();
  nodes.forEach(node => {
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node);
    else children.set(node.parentId, [node]);
  });
  let visited = 0;
  const bind = (instance: InstanceNode, native: RuntimeNode): void => {
    bindings.set(instance.source.id, native);
    if (instance.source.subtreeId && adapter.subtreeTopology === 'inlined') {
      bind(instance.children[0], native);
      return;
    }
    visited++;
    const descendants = children.get(native.id) || [];
    if (descendants.length !== instance.children.length)
      throw new Error('Native topology differs from the XML projection. Live states cannot be mapped safely.');
    instance.children.forEach((child, index) => bind(child, descendants[index]));
  };
  try {
    const roots = children.get(null) || [];
    if (roots.length !== 1) throw new Error('Expected one native tree root.');
    bind(projection.root, roots[0]);
    if (visited !== nodes.length) throw new Error('Unexpected native nodes in the XML projection.');
    return { bindings, error: null };
  } catch (error) {
    return { bindings: new Map<string, RuntimeNode>(), error: (error as Error).message };
  }
}

export function liveSourceNode(source: SourceNode, native?: RuntimeNode): SourceNode {
  if (!native) return source;
  return {
    ...native,
    ...source,
    runtimeId: native.id,
    status: native.status,
    nativeStatus: native.nativeStatus,
    feedback: native.feedback,
    ports: native.ports,
    lastResult: native.lastResult,
    lastNativeResult: native.lastNativeResult,
  };
}
