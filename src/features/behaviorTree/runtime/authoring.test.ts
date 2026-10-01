import { describe, expect, it } from 'vitest';
import {
  addEditorNode,
  attributesOf,
  childrenOf,
  connectEditorNodes,
  editAttributes,
  editorAddresses,
  editorState,
  editorView,
  executableXml,
  importSubtreeLibrary,
  parseNode,
  removeEditorBranch,
  reorderEditorNode,
  serializeEditor,
} from './authoring';
import { blankXml, inspectXml, nativeTreeFromXml, treeFormats, validateDocument } from './xml';
import { bindRuntimeProjection, projectXml } from './projection';
import { parseBehaviorTreeFile, saveBehaviorTree, loadBehaviorTree } from '../storage/treeStorage';
import type { NativeTreeDocument } from './types';

const library = (runtime: 'btcpp' | 'py_trees'): NativeTreeDocument => ({
  runtime,
  xml: `<root ${runtime === 'btcpp' ? 'BTCPP_format="4"' : ''} custom="retained">
 <!-- library metadata -->
 <BehaviorTree ID="Task"><Sequence ${runtime === 'py_trees' ? 'memory="false"' : ''}><SubTree ID="Delay" seconds="{delay}"/></Sequence></BehaviorTree>
 <BehaviorTree ID="Delay" ${runtime === 'py_trees' ? 'seconds="0.2"' : ''}><Wait seconds="{seconds}"/></BehaviorTree>
 <TreeNodesModel><SubTree ID="Task"><input_port name="delay" default="0.2"/></SubTree><SubTree ID="Delay"><input_port name="seconds" default="0.2"/></SubTree></TreeNodesModel>
</root>`,
});

describe.each(treeFormats)('$id native authoring', format => {
  it('keeps original source exact for unchanged graph and layout-only changes', () => {
    const document = { runtime: format.id, xml: format.template };
    const editor = editorState(document);
    editor.nodes[0].position = { x: 10, y: 20 };
    expect(serializeEditor(document, editor)).toBe(document.xml);
    expect(validateDocument({ ...document, editor }).xml).toBe(document.xml);
  });
  it('builds a tree from disconnected nodes with native defaults, ports, ordering and deletion', () => {
    const document = { runtime: format.id, xml: blankXml(format.id) };
    let editor = editorState(document);
    const root = editor.nodes[0];
    editor = addEditorNode(document, editor, 'Main', 'Wait', {}, null, { x: 50, y: 220 });
    const first = editor.nodes[1];
    expect(() => validateDocument({ ...document, editor })).toThrow('Connect all nodes');
    editor = connectEditorNodes(document, editor, root.id, first.id);
    editor = addEditorNode(document, editor, 'Main', 'Wait', { name: 'Second', seconds: '0.1' }, root.id);
    const second = editor.nodes[2];
    editor = reorderEditorNode(editor, second.id, -1);
    const view = editorView(editor, 'Main', 'main');
    expect(view.slice(1).map(node => node.editId)).toEqual([second.id, first.id]);
    expect(view.slice(1).map(node => node.childOrder)).toEqual([1, 2]);
    let parsed = inspectXml(executableXml({ ...document, editor }), format.id);
    expect(parsed.trees[0].children[0].children[0].getAttribute('name')).toBe('Second');
    editor = editAttributes(editor, first.id, { seconds: '0.3', name: 'Edited', note: '"<&' });
    parsed = inspectXml(executableXml({ ...document, editor }), format.id);
    expect(parsed.trees[0].children[0].children[1].getAttribute('note')).toBe('"<&');
    expect(parsed.trees[0].children[0].getAttribute('memory')).toBe(format.id === 'py_trees' ? 'true' : null);
    expect(() => connectEditorNodes(document, editor, first.id, root.id)).toThrow('cycle');
    expect(() => connectEditorNodes(document, editor, first.id, second.id)).toThrow('cannot accept');
    editor = removeEditorBranch(editor, second.id);
    expect(childrenOf(editor, 'Main', root.id)).toHaveLength(1);
    expect(validateDocument({ ...document, editor }).editor).toBeUndefined();
  });
  it('imports all library dependencies and port metadata without replacing the active main tree', () => {
    const document = { runtime: format.id, xml: blankXml(format.id) };
    let result = importSubtreeLibrary(document, editorState(document), library(format.id));
    const editor = addEditorNode(result, result.editor!, 'Main', 'SubTree', { ID: 'Task' }, result.editor!.nodes[0].id);
    result = { ...result, editor };
    const xml = executableXml(result);
    const parsed = inspectXml(xml, format.id);
    expect(parsed.mainTreeId).toBe('Main');
    expect(parsed.trees.map(tree => tree.getAttribute('ID'))).toEqual(['Main', 'Task', 'Delay']);
    expect(xml).toContain('library metadata');
    expect(parsed.root.getAttribute('custom')).toBe('retained');
    expect(parsed.root.querySelector('TreeNodesModel input_port')?.getAttribute('default')).toBe('0.2');
    const inserted = editor.nodes[editor.nodes.length - 1];
    expect(attributesOf(parseNode(inserted.template)).delay).toBe('0.2');
  });
  it('keeps subtree defaults specific to the native format', () => {
    const document = {
      runtime: format.id,
      xml: `<root ${format.id === 'btcpp' ? 'BTCPP_format="4"' : ''}>
      <BehaviorTree ID="Main"><Sequence/></BehaviorTree>
      <BehaviorTree ID="Task" description="metadata" delay="0.6"><Wait seconds="0.1"/></BehaviorTree>
      <TreeNodesModel><SubTree ID="Task"><input_port name="delay" default="0.2"/></SubTree></TreeNodesModel>
    </root>`,
    };
    const editor = editorState(document);
    const added = addEditorNode(document, editor, 'Main', 'SubTree', { ID: 'Task' }, editor.nodes[0].id);
    const ports = attributesOf(parseNode(added.nodes[added.nodes.length - 1].template));
    expect(ports.delay).toBe(format.id === 'btcpp' ? '0.2' : '0.6');
    expect(ports.description).toBe(format.id === 'btcpp' ? undefined : 'metadata');
  });
  it('rejects collisions atomically and explicitly prefixes nested references and models', () => {
    const document = { runtime: format.id, xml: blankXml(format.id) };
    const original = editorState(document);
    const once = importSubtreeLibrary(document, original, library(format.id));
    expect(() => importSubtreeLibrary(once, once.editor!, library(format.id))).toThrow('already exists');
    expect(original.nodes).toHaveLength(1);
    const twice = importSubtreeLibrary(once, once.editor!, library(format.id), 'second');
    expect(twice.xml).toContain('ID="second_Delay"');
    expect(twice.xml).toContain('ID="second_Task"');
    expect(twice.editor!.nodes.map(node => node.treeId)).toContain('second_Task');
    const other = treeFormats.find(item => item.id !== format.id)!;
    expect(() => importSubtreeLibrary(document, original, { runtime: other.id, xml: other.template })).toThrow(
      'same engine'
    );
  });
  it('saves/reloads disconnected drafts and rejects malformed editor data at the file boundary', () => {
    const tree = nativeTreeFromXml(blankXml(format.id), format.id);
    const editor = addEditorNode(tree.nativeDocument!, editorState(tree.nativeDocument!), 'Main', 'Wait');
    tree.nativeDocument!.editor = editor;
    expect(saveBehaviorTree(tree)).toBe(true);
    expect(loadBehaviorTree(tree.id)?.nativeDocument?.editor).toEqual(editor);
    const reloaded = parseBehaviorTreeFile(JSON.stringify({ tree }), 'draft.json');
    expect(reloaded.nativeDocument!.editor).toEqual(editor);
    expect(() => validateDocument(reloaded.nativeDocument!)).toThrow('Connect all nodes');
    tree.nativeDocument!.editor.nodes[1].parentId = 'missing';
    expect(() => parseBehaviorTreeFile(JSON.stringify({ tree }), 'draft.json')).toThrow('Missing');
  });
  it('uses stable editor IDs in source projections for loaded runtime bindings', () => {
    const document = { runtime: format.id, xml: format.template };
    const editor = editorState(document);
    const projection = projectXml(document.xml, format.id, 'Main', editorAddresses(editor));
    const view = editorView(editor, 'Main', 'main');
    expect(projection.nodes.map(node => node.id)).toEqual(view.map(node => node.id));
    const native = projection.nodes.map((node, index) => ({
      ...node,
      id: `native-${index}`,
      parentId: index ? 'native-0' : null,
      status: 'running' as const,
    }));
    const binding = bindRuntimeProjection(projection, native);
    expect(binding.error).toBeNull();
    expect(binding.bindings.get(view[1].id)?.id).toBe('native-1');
  });
});

it('validates native decorator arity and rejects unsafe templates, cycles and deep drafts', () => {
  const document = { runtime: 'btcpp' as const, xml: blankXml('btcpp') };
  let editor = editorState(document);
  editor = addEditorNode(document, editor, 'Main', 'Inverter', {}, editor.nodes[0].id);
  expect(() => validateDocument({ ...document, editor })).toThrow('one child');
  for (const template of ['<!DOCTYPE root><Wait/>', '<Wait><child/></Wait>', '<Include/>'])
    expect(() => parseNode(template)).toThrow();
  editor.nodes[0].parentId = editor.nodes[1].id;
  expect(() => editorState({ ...document, editor })).toThrow('recursive');
});
