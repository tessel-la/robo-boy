import { v4 as uuid } from 'uuid';
import type { NativeEditorNode, NativeEditorState, NativeTreeDocument, NativeNodeTemplate } from './types';
import type { SourceNode } from './projection';
import { inspectXml, treeFormats } from './xml';

const serialize = (node: Node) => new XMLSerializer().serializeToString(node);
export const attributesOf = (element: Element) =>
  Object.fromEntries(Array.from(element.attributes).map(a => [a.name, a.value]));
export function parseNode(template: string): Element {
  if (
    typeof template !== 'string' ||
    new TextEncoder().encode(template).length > 512 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(template)
  )
    throw new Error('Invalid editor node XML.');
  const doc = new DOMParser().parseFromString(template, 'application/xml');
  if (
    doc.querySelector('parsererror') ||
    doc.documentElement.children.length ||
    ['root', 'behaviortree', 'include', 'import'].includes(doc.documentElement.tagName.toLowerCase())
  )
    throw new Error('Editor nodes must contain a single node element without child elements.');
  return doc.documentElement;
}
export function editorState(document: NativeTreeDocument): NativeEditorState {
  const inspected = inspectXml(document.xml, document.runtime);
  if (document.editor) {
    const editor = document.editor;
    if (editor.version !== 1 || !Array.isArray(editor.nodes) || editor.nodes.length > 2048)
      throw new Error('Invalid visual draft.');
    const ids = new Set<string>();
    const trees = new Set(inspected.trees.map(tree => tree.getAttribute('ID')));
    let bytes = 0;
    for (const node of editor.nodes) {
      if (
        !node ||
        typeof node.id !== 'string' ||
        !node.id ||
        node.id.length > 128 ||
        ids.has(node.id) ||
        !trees.has(node.treeId) ||
        (node.parentId !== null && typeof node.parentId !== 'string') ||
        !Number.isSafeInteger(node.order) ||
        node.order < 0 ||
        (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)))
      )
        throw new Error('Invalid visual draft node.');
      ids.add(node.id);
      parseNode(node.template);
      bytes += new TextEncoder().encode(node.template).length;
    }
    if (bytes > 512 * 1024) throw new Error('Visual draft exceeds 512 KiB.');
    const byId = new Map(editor.nodes.map(node => [node.id, node]));
    for (const node of editor.nodes) {
      const visited = new Set([node.id]);
      let parent = node.parentId;
      while (parent) {
        const ancestor = byId.get(parent);
        if (!ancestor || ancestor.treeId !== node.treeId || visited.has(parent) || visited.size > 64)
          throw new Error('Missing, recursive or cross-definition parent in visual draft.');
        visited.add(parent);
        parent = ancestor.parentId;
      }
    }
    return editor;
  }
  const nodes: NativeEditorNode[] = [];
  const walk = (element: Element, treeId: string, parentId: string | null, order: number) => {
    const id = uuid();
    const shallow = element.cloneNode(true) as Element;
    Array.from(shallow.children).forEach(child => child.remove());
    nodes.push({ id, treeId, parentId, order, template: serialize(shallow) });
    Array.from(element.children).forEach((child, index) => walk(child, treeId, id, index));
  };
  inspected.trees.forEach(tree => walk(tree.children[0], tree.getAttribute('ID')!, null, 0));
  return { version: 1, nodes };
}
export const childrenOf = (editor: NativeEditorState, treeId: string, parentId: string | null) =>
  editor.nodes.filter(node => node.treeId === treeId && node.parentId === parentId).sort((a, b) => a.order - b.order);

export function serializeEditor(document: NativeTreeDocument, editor = document.editor): string {
  if (!editor) return document.xml;
  editorState({ ...document, editor });
  const root = inspectXml(document.xml, document.runtime).root;
  const matches = (element: Element, node: NativeEditorNode): boolean => {
    const shallow = element.cloneNode(true) as Element;
    Array.from(shallow.children).forEach(child => child.remove());
    const children = childrenOf(editor, node.treeId, node.id);
    return (
      node.template === serialize(shallow) &&
      children.length === element.children.length &&
      children.every((child, index) => matches(element.children[index], child))
    );
  };
  if (
    Array.from(root.children)
      .filter(tree => tree.tagName === 'BehaviorTree')
      .every(tree => {
        const roots = childrenOf(editor, tree.getAttribute('ID')!, null);
        return roots.length === 1 && matches(tree.children[0], roots[0]);
      })
  )
    return document.xml;
  const build = (node: NativeEditorNode): Element => {
    const element = root.ownerDocument.importNode(parseNode(node.template), true);
    childrenOf(editor, node.treeId, node.id).forEach(child => element.appendChild(build(child)));
    return element;
  };
  Array.from(root.children)
    .filter(tree => tree.tagName === 'BehaviorTree')
    .forEach(tree => {
      Array.from(tree.children).forEach(child => child.remove());
      childrenOf(editor, tree.getAttribute('ID')!, null).forEach(node => tree.appendChild(build(node)));
    });
  return serialize(root.ownerDocument);
}
export function executableXml(document: NativeTreeDocument, requireMain = true): string {
  if (document.editor) {
    const definitions = inspectXml(document.xml, document.runtime).trees;
    definitions.forEach(tree => {
      const count = childrenOf(document.editor!, tree.getAttribute('ID')!, null).length;
      if (count !== 1)
        throw new Error(`Connect all nodes in "${tree.getAttribute('ID')}" into one tree (${count} roots).`);
    });
  }
  const xml = serializeEditor(document);
  const inspected = inspectXml(xml, document.runtime, document.mainTreeId);
  const editor = document.editor || editorState(document);
  editor.nodes.forEach(node => {
    const rule = nodeTemplate(document, parseNode(node.template).tagName);
    const count = childrenOf(editor, node.treeId, node.id).length;
    if (
      (rule.children === 'none' && count !== 0) ||
      (rule.children === 'one' && count !== 1) ||
      (rule.children === 'many' && count === 0)
    )
      throw new Error(
        `${parseNode(node.template).tagName} needs ${rule.children === 'many' ? 'at least one child' : rule.children === 'one' ? 'one child' : 'no children'}.`
      );
  });
  if (requireMain && !inspected.mainTreeId) throw new Error('Choose the main tree to execute.');
  return xml;
}
export function nodeTemplate(document: NativeTreeDocument, name: string): NativeNodeTemplate {
  const format = treeFormats.find(f => f.id === document.runtime);
  const builtin =
    format?.editorNodes[name] ||
    Object.entries(format?.editorNodes || {}).find(([tag]) => tag.toLowerCase() === name.toLowerCase())?.[1];
  if (builtin) return builtin;
  const model = Array.from(inspectXml(document.xml, document.runtime).root.querySelectorAll('TreeNodesModel > *')).find(
    el => el.getAttribute('ID') === name
  );
  const defaults = model
    ? Object.fromEntries(
        Array.from(model.children)
          .filter(port => port.hasAttribute('default'))
          .map(port => [port.getAttribute('name')!, port.getAttribute('default')!])
      )
    : {};
  const kind = model?.tagName || name;
  return {
    defaults,
    children:
      kind === 'Control'
        ? 'many'
        : kind === 'Decorator'
          ? 'one'
          : ['Action', 'Condition'].includes(kind)
            ? 'none'
            : 'host',
  };
}
export function editorAddresses(editor: NativeEditorState) {
  const addresses = new Map<string, string>();
  const walk = (node: NativeEditorNode, path: string) => {
    addresses.set(`${node.treeId}:${path}`, node.id);
    childrenOf(editor, node.treeId, node.id).forEach((child, index) => walk(child, `${path}/${index}`));
  };
  new Set(editor.nodes.map(node => node.treeId)).forEach(id =>
    childrenOf(editor, id, null).forEach((node, index) => walk(node, String(index)))
  );
  return addresses;
}
export function editorView(editor: NativeEditorState, treeId: string, prefix: string): SourceNode[] {
  const ordered: NativeEditorNode[] = [];
  const visit = (parentId: string | null) =>
    childrenOf(editor, treeId, parentId).forEach(node => {
      ordered.push(node);
      visit(node.id);
    });
  visit(null);
  return ordered.map(node => {
    const element = parseNode(node.template);
    const subtree = ['subtree', 'subtreeplus'].includes(element.tagName.toLowerCase());
    return {
      id: `${prefix}/${node.id}`,
      editId: node.id,
      parentId: node.parentId ? `${prefix}/${node.parentId}` : null,
      childOrder: node.parentId
        ? childrenOf(editor, treeId, node.parentId).findIndex(child => child.id === node.id) + 1
        : undefined,
      label: element.getAttribute('name') || element.getAttribute('ID') || element.tagName,
      type: element.tagName,
      attributes: attributesOf(element),
      status: 'idle',
      nativeStatus: 'IDLE',
      feedback: '',
      position: node.position,
      ...(subtree ? { subtreeId: element.getAttribute('ID')!, subtreeView: `${prefix}/${node.id}` } : {}),
    };
  });
}
export function addEditorNode(
  document: NativeTreeDocument,
  editor: NativeEditorState,
  treeId: string,
  tag: string,
  attributes: Record<string, string> = {},
  parentId: string | null = null,
  position?: { x: number; y: number }
): NativeEditorState {
  if (!/^[A-Za-z_][\w.-]*$/.test(tag)) throw new Error('Invalid node type.');
  const element = new DOMParser().parseFromString(`<${tag}/>`, 'application/xml').documentElement;
  const subtreePorts: Record<string, string> = {};
  if (tag.toLowerCase() === 'subtree' && attributes.ID) {
    const root = inspectXml(document.xml, document.runtime).root;
    const definition = Array.from(root.children).find(
      el => el.tagName === 'BehaviorTree' && el.getAttribute('ID') === attributes.ID
    );
    if (!definition) throw new Error(`Missing subtree: ${attributes.ID}`);
    Object.assign(
      subtreePorts,
      treeFormats.find(format => format.id === document.runtime)?.subtreeDefaults(definition) || {}
    );
    const model = Array.from(root.querySelectorAll('TreeNodesModel > SubTree')).find(
      el => el.getAttribute('ID') === attributes.ID
    );
    Array.from(model?.children || []).forEach(port => {
      const name = port.getAttribute('name');
      if (name && !(name in subtreePorts)) subtreePorts[name] = port.getAttribute('default') ?? `{${name}}`;
    });
  }
  Object.entries({ ...nodeTemplate(document, tag).defaults, ...subtreePorts, ...attributes }).forEach(([name, value]) =>
    element.setAttribute(name, value)
  );
  const node: NativeEditorNode = {
    id: uuid(),
    treeId,
    parentId: null,
    order: childrenOf(editor, treeId, null).length,
    template: serialize(element),
    position,
  };
  const added = { ...editor, nodes: [...editor.nodes, node] };
  return parentId ? connectEditorNodes(document, added, parentId, node.id) : added;
}
export function connectEditorNodes(
  document: NativeTreeDocument,
  editor: NativeEditorState,
  parentId: string,
  childId: string
): NativeEditorState {
  const parent = editor.nodes.find(node => node.id === parentId);
  const child = editor.nodes.find(node => node.id === childId);
  if (!parent || !child || parent.treeId !== child.treeId || parentId === childId)
    throw new Error('Connect nodes in the same definition.');
  let ancestor: NativeEditorNode | undefined = parent;
  while (ancestor) {
    if (ancestor.id === childId) throw new Error('A connection cannot create a cycle.');
    ancestor = editor.nodes.find(node => node.id === ancestor!.parentId);
  }
  const rule = nodeTemplate(document, parseNode(parent.template).tagName);
  const siblings = childrenOf(editor, parent.treeId, parentId).filter(node => node.id !== childId);
  if (rule.children === 'none' || (rule.children === 'one' && siblings.length))
    throw new Error(`${parseNode(parent.template).tagName} cannot accept another child.`);
  return {
    ...editor,
    nodes: editor.nodes.map(node =>
      node.id === childId
        ? { ...node, parentId, order: siblings.length ? Math.max(...siblings.map(s => s.order)) + 1 : 0 }
        : node
    ),
  };
}
export function removeEditorBranch(editor: NativeEditorState, id: string): NativeEditorState {
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    editor.nodes.forEach(node => {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    });
  }
  return { ...editor, nodes: editor.nodes.filter(node => !removed.has(node.id)) };
}
export function editAttributes(
  editor: NativeEditorState,
  id: string,
  attributes: Record<string, string>
): NativeEditorState {
  return {
    ...editor,
    nodes: editor.nodes.map(node => {
      if (node.id !== id) return node;
      const element = parseNode(node.template);
      Array.from(element.attributes).forEach(attribute => element.removeAttribute(attribute.name));
      Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
      return { ...node, template: serialize(element) };
    }),
  };
}
export function reorderEditorNode(editor: NativeEditorState, id: string, offset: -1 | 1): NativeEditorState {
  const node = editor.nodes.find(item => item.id === id)!;
  const siblings = childrenOf(editor, node.treeId, node.parentId);
  const index = siblings.findIndex(item => item.id === id);
  if (!siblings[index + offset]) return editor;
  [siblings[index], siblings[index + offset]] = [siblings[index + offset], siblings[index]];
  const orders = new Map(siblings.map((item, order) => [item.id, order]));
  return {
    ...editor,
    nodes: editor.nodes.map(item => (orders.has(item.id) ? { ...item, order: orders.get(item.id)! } : item)),
  };
}

/** Atomic library import: copy native definitions/dependencies; never translate formats. */
export function importSubtreeLibrary(
  destination: NativeTreeDocument,
  editor: NativeEditorState,
  source: NativeTreeDocument,
  prefix = ''
): NativeTreeDocument {
  if (!destination.runtime) throw new Error('Choose the engine before importing a subtree library.');
  if (source.runtime && source.runtime !== destination.runtime)
    throw new Error('Subtree libraries must use the same engine as the current tree.');
  if (prefix && !/^[A-Za-z_][\w.-]*$/.test(prefix))
    throw new Error('Use letters, numbers, underscores, dots or hyphens for the prefix.');
  const target = inspectXml(destination.xml, destination.runtime).root;
  const imported = inspectXml(executableXml(source, false), destination.runtime).root;
  if (prefix) {
    if (imported.hasAttribute('main_tree_to_execute'))
      imported.setAttribute('main_tree_to_execute', `${prefix}_${imported.getAttribute('main_tree_to_execute')}`);
    imported.querySelectorAll('*').forEach(element => {
      if (
        ['behaviortree', 'subtree', 'subtreeplus'].includes(element.tagName.toLowerCase()) &&
        element.hasAttribute('ID')
      )
        element.setAttribute('ID', `${prefix}_${element.getAttribute('ID')}`);
    });
  }
  const existingIds = new Set(
    Array.from(target.children)
      .filter(el => el.tagName === 'BehaviorTree')
      .map(el => el.getAttribute('ID'))
  );
  for (const definition of Array.from(imported.children).filter(el => el.tagName === 'BehaviorTree')) {
    const id = definition.getAttribute('ID')!;
    if (existingIds.has(id))
      throw new Error(`Tree ID "${id}" already exists. Set a unique library prefix or rename that definition.`);
  }
  for (const attribute of Array.from(imported.attributes)) {
    if (['main_tree_to_execute', 'BTCPP_format'].includes(attribute.name)) continue;
    if (target.hasAttribute(attribute.name) && target.getAttribute(attribute.name) !== attribute.value)
      throw new Error(`Conflicting library metadata: ${attribute.name}.`);
    target.setAttribute(attribute.name, attribute.value);
  }
  for (const metadata of Array.from(imported.childNodes)) {
    if (metadata.nodeType === Node.ELEMENT_NODE && (metadata as Element).tagName === 'TreeNodesModel') {
      let models = Array.from(target.children).find(el => el.tagName === 'TreeNodesModel');
      if (!models) {
        models = target.ownerDocument.createElement('TreeNodesModel');
        target.appendChild(models);
      }
      for (const model of Array.from((metadata as Element).children)) {
        const existing = Array.from(models.children).find(el => el.getAttribute('ID') === model.getAttribute('ID'));
        if (existing && serialize(existing) !== serialize(model))
          throw new Error(`Conflicting node/port model: ${model.getAttribute('ID')}.`);
        if (!existing) models.appendChild(target.ownerDocument.importNode(model, true));
      }
    } else target.appendChild(target.ownerDocument.importNode(metadata, true));
  }
  const importedEditor = editorState({
    ...source,
    runtime: destination.runtime,
    xml: serialize(imported),
    editor: undefined,
  });
  const result = {
    ...destination,
    xml: serialize(target.ownerDocument),
    editor: { version: 1 as const, nodes: [...editor.nodes, ...importedEditor.nodes] },
  };
  editorState(result);
  return result;
}
