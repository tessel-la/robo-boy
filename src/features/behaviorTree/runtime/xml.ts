import { v4 as uuidv4 } from 'uuid';
import { BehaviorTree } from '../types';
import { NativeTreeDocument, TreeFormatAdapter, TreeRuntimeId } from './types';

export const newXmlTemplate =
  '<root main_tree_to_execute="Main">\n  <BehaviorTree ID="Main">\n    <Wait name="Wait" seconds="0.5"/>\n  </BehaviorTree>\n</root>';

export const treeFormats: readonly TreeFormatAdapter[] = [
  {
    id: 'btcpp',
    label: 'BehaviorTree.CPP',
    template:
      '<root BTCPP_format="4" main_tree_to_execute="Main">\n  <BehaviorTree ID="Main">\n    <Sequence name="Demo">\n      <Wait name="Wait" seconds="0.5"/>\n      <AlwaysSuccess name="Done"/>\n    </Sequence>\n  </BehaviorTree>\n</root>',
    matches: root => root.getAttribute('BTCPP_format') === '4',
    validate: root => {
      if (root.getAttribute('BTCPP_format') !== '4') throw new Error('BehaviorTree.CPP requires BTCPP_format="4".');
    },
  },
  {
    id: 'py_trees',
    label: 'py_trees',
    template:
      '<root main_tree_to_execute="Main">\n  <BehaviorTree ID="Main">\n    <Sequence name="Demo" memory="true">\n      <Wait name="Wait" seconds="0.5"/>\n      <Success name="Done"/>\n    </Sequence>\n  </BehaviorTree>\n</root>',
    // Shared XML syntax is ambiguous; absence of the C++ marker is not identification.
    matches: () => false,
    validate: root => {
      if (root.hasAttribute('BTCPP_format'))
        throw new Error('This document declares BehaviorTree.CPP. Select that format or explicitly edit its source.');
    },
  },
];

export function inspectXml(xml: string, runtime?: TreeRuntimeId | null, mainTreeId?: string) {
  if (new TextEncoder().encode(xml).length > 512 * 1024) throw new Error('XML exceeds 512 KiB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are unsupported.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML.');
  const root = doc.documentElement;
  if (root.tagName !== 'root') throw new Error('Expected a <root> XML document.');
  const all = Array.from(root.querySelectorAll('*'));
  if (all.length > 2048) throw new Error('Tree exceeds 2048 XML elements.');
  if (all.some(el => ['include', 'import'].includes(el.tagName.toLowerCase()))) {
    throw new Error('Remote XML must be self-contained; inline includes/imports.');
  }
  const resolvedRuntime = runtime ?? treeFormats.find(format => format.matches(root))?.id ?? null;
  if (resolvedRuntime) treeFormats.find(format => format.id === resolvedRuntime)!.validate(root);
  const trees = Array.from(root.children).filter(el => el.tagName === 'BehaviorTree');
  const ids = trees.map(tree => tree.getAttribute('ID'));
  if (
    !trees.length ||
    ids.some(id => !id) ||
    new Set(ids).size !== ids.length ||
    trees.some(tree => tree.children.length !== 1)
  ) {
    throw new Error('Each BehaviorTree needs a unique ID and exactly one root node.');
  }
  const selected = mainTreeId || root.getAttribute('main_tree_to_execute') || (ids.length === 1 ? ids[0]! : '');
  if (selected && !ids.includes(selected)) throw new Error('Select a valid main_tree_to_execute.');
  let count = 0;
  const walk = (node: Element, stack: string[], depth: number): void => {
    if (++count > 2048 || depth > 64) throw new Error('Expanded tree exceeds node/depth limits.');
    if (['subtree', 'subtreeplus'].includes(node.tagName.toLowerCase())) {
      const id = node.getAttribute('ID') || '';
      if (!ids.includes(id) || stack.includes(id)) throw new Error(`Missing or recursive subtree: ${id}`);
      walk(trees[ids.indexOf(id)].children[0], [...stack, id], depth + 1);
    }
    Array.from(node.children).forEach(child => walk(child, stack, depth + 1));
  };
  trees.forEach(tree => walk(tree.children[0], [tree.getAttribute('ID')!], 0));
  return { root, runtime: resolvedRuntime, mainTreeId: selected, trees };
}

export function nativeTreeFromXml(
  xml: string,
  runtime?: TreeRuntimeId | null,
  name = 'XML tree',
  mainTreeId?: string
): BehaviorTree {
  const inspected = inspectXml(xml, runtime, mainTreeId);
  const now = Date.now();
  return {
    id: `xml-${uuidv4()}`,
    name,
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
    nativeDocument: { xml, runtime: inspected.runtime, mainTreeId: inspected.mainTreeId },
  };
}

export function validateDocument(document: NativeTreeDocument): NativeTreeDocument {
  const inspected = inspectXml(document.xml, document.runtime, document.mainTreeId);
  if (!inspected.runtime)
    throw new Error('Choose the XML runtime. This document uses syntax shared by both frameworks.');
  if (!inspected.mainTreeId) throw new Error('Choose the main tree to execute.');
  return { ...document, runtime: inspected.runtime, mainTreeId: inspected.mainTreeId };
}
