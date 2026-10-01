import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeTreeController } from './useNativeTreeController';
import { projectXml } from './projection';
import { blankXml, nativeTreeFromXml, treeFormats } from './xml';
import { useState } from 'react';
import type { useRemoteTreeRuntime } from './useRemoteTreeRuntime';

const client = { load: vi.fn(), start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), reset: vi.fn(), validate: vi.fn() };
let runtime: ReturnType<typeof useRemoteTreeRuntime>;
beforeEach(() => {
  vi.clearAllMocks();
  Object.values(client).forEach(fn => fn.mockResolvedValue({}));
  runtime = {
    client,
    state: {
      connected: true,
      runtimes: treeFormats.map(f => ({ id: f.id, available: true })),
      session: null,
      logs: [],
      error: null,
    },
  } as unknown as typeof runtime;
});
describe('native controller in the common editor', () => {
  it.each(treeFormats)('loads and runs $id through the same lifecycle', async format => {
    const tree = nativeTreeFromXml(format.template, format.id);
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, format.id, vi.fn()));
    act(() => {
      result.current.run();
    });
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(client.load).toHaveBeenCalledWith(tree.nativeDocument);
  });
  it.each(treeFormats)('keeps $id draft edits, history, IDs and compiled host source synchronized', async format => {
    const initial = nativeTreeFromXml(blankXml(format.id), format.id);
    const { result } = renderHook(() => {
      const [tree, setTree] = useState(initial);
      return useNativeTreeController(tree, runtime, format.id, setTree);
    });
    const root = result.current.nodes[0].editId!;
    const view = result.current.viewKey;
    act(() => result.current.addNode('Wait', { seconds: '0.1' }, { x: 100, y: 200 }));
    const leaf = result.current.nodes[1].editId!;
    expect(result.current.error).toContain('Connect all nodes');
    act(() => result.current.run());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(client.load).not.toHaveBeenCalled();
    act(() => result.current.connect(root, leaf));
    expect(result.current.error).toBeNull();
    expect(result.current.viewKey).toBe(view);
    act(() => result.current.undo());
    expect(result.current.error).toContain('Connect all nodes');
    expect(result.current.nodes[1].editId).toBe(leaf);
    act(() => result.current.redo());
    expect(result.current.error).toBeNull();
    act(() => result.current.run());
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(client.load).toHaveBeenCalledWith({
      runtime: format.id,
      mainTreeId: 'Main',
      xml: result.current.document!.xml,
    });
    expect(client.load.mock.calls[0][0].editor).toBeUndefined();
  });
  it('resets the terminal session before rerunning', async () => {
    const tree = nativeTreeFromXml(treeFormats[0].template);
    runtime.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml: tree.nativeDocument!.xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'completed',
      result: 'success',
      error: null,
    };
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', vi.fn()));
    act(() => {
      result.current.run();
    });
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(client.reset.mock.invocationCallOrder[0]).toBeLessThan(client.start.mock.invocationCallOrder[0]);
  });
  it('keeps source when a different engine is selected and disables running', async () => {
    const tree = nativeTreeFromXml(treeFormats[0].template);
    const changed = vi.fn();
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'py_trees', changed));
    expect(result.current.ready).toBe(false);
    act(() => {
      result.current.run();
    });
    await waitFor(() => expect(result.current.error).toContain('matching this XML'));
    expect(client.load).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(result.current.document!.xml).toBe(treeFormats[0].template);
  });
  it('locks source during execution and reports unavailable engines', () => {
    const tree = nativeTreeFromXml(treeFormats[0].template);
    runtime.state.runtimes[0].available = false;
    const changed = vi.fn();
    const { result, rerender } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', changed));
    expect(result.current.ready).toBe(false);
    runtime.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml: tree.nativeDocument!.xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'running',
      result: null,
      error: null,
    };
    rerender();
    act(() => result.current.changeDocument({ xml: '<root/>' }));
    expect(changed).not.toHaveBeenCalled();
  });
  it('browses subtree ports without replacing the document or main tree', () => {
    const xml =
      '<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><SubTree ID="Move" target="{destination}"/></BehaviorTree><BehaviorTree ID="Move"><Wait seconds="{delay}"/></BehaviorTree></root>';
    const tree = nativeTreeFromXml(xml);
    runtime.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'loaded',
      result: null,
      error: null,
    };
    const changed = vi.fn();
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', changed));
    expect(result.current.preview.nodes[0].attributes.target).toBe('{destination}');
    act(() => result.current.selectTree('Move'));
    expect(result.current.session?.id).toBe('s');
    expect(result.current.nodes[0].type).toBe('Wait');
    expect(result.current.document!.mainTreeId).toBe('Main');
    expect(result.current.preview.mainTreeId).toBe('Main');
    expect(changed).not.toHaveBeenCalled();
  });
  it('returns through nested library definitions before they have an executable instance', () => {
    const tree = nativeTreeFromXml(`<root BTCPP_format="4" main_tree_to_execute="Main">
      <BehaviorTree ID="Main"><Wait/></BehaviorTree>
      <BehaviorTree ID="Library"><SubTree ID="Child"/></BehaviorTree>
      <BehaviorTree ID="Child"><SubTree ID="Leaf"/></BehaviorTree>
      <BehaviorTree ID="Leaf"><Wait/></BehaviorTree></root>`);
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', vi.fn()));
    act(() => result.current.selectTree('Library'));
    act(() => result.current.openSubtree(result.current.nodes[0].subtreeView!));
    expect(result.current.viewTreeId).toBe('Child');
    act(() => result.current.openSubtree(result.current.nodes[0].subtreeView!));
    expect(result.current.viewTreeId).toBe('Leaf');
    act(() => result.current.parentView());
    expect(result.current.viewTreeId).toBe('Child');
    act(() => result.current.parentView());
    expect(result.current.viewTreeId).toBe('Library');
    act(() => result.current.parentView());
    expect(result.current.viewTreeId).toBeUndefined();
    expect(result.current.nodes[0].type).toBe('Wait');
  });
  it('returns to live main-tree state after browsing when the entrypoint is inferred from XML', () => {
    const xml =
      '<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><SubTree ID="Child"/></BehaviorTree><BehaviorTree ID="Child"><Wait/></BehaviorTree></root>';
    const tree = nativeTreeFromXml(xml);
    tree.nativeDocument!.mainTreeId = undefined;
    runtime.state.session = {
      id: 's',
      runtime: 'btcpp',
      xml,
      mainTreeId: 'Main',
      nodes: [],
      state: 'loaded',
      result: null,
      error: null,
    };
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', vi.fn()));
    act(() => result.current.selectTree('Child'));
    expect(result.current.nodes[0].type).toBe('Wait');
    expect(result.current.preview.mainTreeId).toBe('Main');
    act(() => result.current.selectTree('Main'));
    expect(result.current.viewTreeId).toBeUndefined();
    expect(result.current.nodes[0].subtreeId).toBe('Child');
  });
  it('rejects an incompatible engine assignment before binding marker-free XML', () => {
    const tree = nativeTreeFromXml(treeFormats[1].template);
    const changed = vi.fn();
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', changed));
    act(() => result.current.assignRuntime('btcpp'));
    expect(changed).not.toHaveBeenCalled();
    expect(result.current.error).toContain('BTCPP_format');
    act(() => result.current.assignRuntime('py_trees'));
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeDocument: expect.objectContaining({ runtime: 'py_trees', xml: tree.nativeDocument!.xml }),
      })
    );
  });
  it('projects original node attributes and preserves duplicate native definitions', () => {
    const xml = '<root><BehaviorTree ID="Main"><Wait name="Delay" seconds="0.5"/></BehaviorTree></root>';
    expect(projectXml(xml, 'py_trees').nodes[0]).toMatchObject({
      label: 'Delay',
      attributes: { name: 'Delay', seconds: '0.5' },
    });
  });
  it('keeps the chosen subtree open when loading, running and resetting', async () => {
    const xml =
      '<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><SubTree ID="Child"/></BehaviorTree><BehaviorTree ID="Child"><Wait/></BehaviorTree></root>';
    const tree = nativeTreeFromXml(xml);
    const { result } = renderHook(() => useNativeTreeController(tree, runtime, 'btcpp', vi.fn()));
    act(() => result.current.openSubtree(result.current.nodes[0].subtreeView!));
    const view = result.current.viewKey;
    act(() => result.current.run());
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    expect(result.current.viewKey).toBe(view);
    expect(result.current.nodes[0].type).toBe('Wait');
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.viewKey).toBe(view);
  });
  it('shows validation errors rather than crashing when a browsed definition is edited', () => {
    const xml =
      '<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><Wait/></BehaviorTree><BehaviorTree ID="Unused"><Wait/></BehaviorTree></root>';
    const tree = nativeTreeFromXml(xml);
    const { result, rerender } = renderHook(({ tree }) => useNativeTreeController(tree, runtime, 'btcpp', vi.fn()), {
      initialProps: { tree },
    });
    act(() => result.current.selectTree('Unused'));
    expect(result.current.nodes[0].type).toBe('Wait');
    rerender({ tree: { ...tree, nativeDocument: { ...tree.nativeDocument!, xml: '<root>' } } });
    expect(result.current.error).toBe('Invalid XML.');
    expect(result.current.nodes).toEqual([]);
  });
});

it.each(['btcpp', 'py_trees'] as const)('watches %s native identities and subtrees without changing a draft or controlling the robot', runtimeId => {
  const draft = nativeTreeFromXml(treeFormats[0].template);
  const change = vi.fn();
  const controls = vi.fn();
  const base = { type: 'Wait', nativeStatus: 'RUNNING', feedback: 'Robot feedback', ports: { seconds: '1.2' } };
  const observed = { id: 'robot', runtime: runtimeId, name: 'Robot mission', source: '/robot/snapshots', connected: true, updatedAt: 1, state: 'running' as const, result: null, error: null, nodes: [
    { ...base, id: 'root', parentId: null, label: 'Mission', status: 'running' as const },
    { ...base, id: 'phase', parentId: 'root', label: 'Phase', status: 'running' as const, subtree: true },
    { ...base, id: 'leaf', parentId: 'phase', label: 'Operation', status: 'running' as const },
  ] };
  const { result, rerender } = renderHook(({ observation }) => useNativeTreeController(draft, runtime, runtimeId, change, undefined, controls, observation), { initialProps: { observation: observed as typeof observed | null } });
  expect(result.current.nodes.map(node => node.id)).toEqual(['root', 'phase']);
  expect(result.current.editable).toBe(false);
  expect(result.current.locked).toBe(true);
  expect(controls).toHaveBeenLastCalledWith(null);
  act(() => result.current.openSubtree('phase'));
  expect(result.current.nodes.map(node => node.id)).toEqual(['phase', 'leaf']);
  act(() => result.current.parentView());
  expect(result.current.nodes.map(node => node.id)).toEqual(['root', 'phase']);
  act(() => { result.current.run(); result.current.stop(); result.current.cancel(); result.current.reset(); result.current.showHost(); });
  expect(change).not.toHaveBeenCalled();
  Object.values(client).forEach(fn => expect(fn).not.toHaveBeenCalled());
  rerender({ observation: null });
  expect(result.current.document?.xml).toBe(draft.nativeDocument!.xml);
});

it('preserves the editor subtree and history while watching, and recovers a removed observation boundary', () => {
  const draft = nativeTreeFromXml('<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><Sequence><SubTree ID="Child"/></Sequence></BehaviorTree><BehaviorTree ID="Child"><Wait/></BehaviorTree></root>');
  const change = vi.fn();
  const base = { type: 'Sequence', nativeStatus: 'RUNNING', status: 'running' as const, feedback: '' };
  const observed = { id: 'robot', runtime: 'btcpp' as const, name: 'Robot', source: 'groot', connected: true, updatedAt: 1, state: 'running' as const, result: null, error: null, nodes: [
    { ...base, id: 'root', parentId: null, label: 'Root' },
    { ...base, id: 'child', parentId: 'root', label: 'Child', subtree: true },
  ] };
  const { result, rerender } = renderHook(({ observation }) => useNativeTreeController(draft, runtime, 'btcpp', change, undefined, undefined, observation), { initialProps: { observation: null as typeof observed | null } });
  const subtree = result.current.nodes.find(node => node.subtreeView)!;
  act(() => result.current.openSubtree(subtree.subtreeView!));
  const editorView = result.current.viewKey;
  act(() => result.current.addNode('Wait'));
  expect(result.current.canUndo).toBe(true);
  change.mockClear();
  rerender({ observation: observed });
  act(() => { result.current.validate(); result.current.load(); result.current.undo(); result.current.addNode('Wait'); });
  expect(change).not.toHaveBeenCalled();
  Object.values(client).forEach(fn => expect(fn).not.toHaveBeenCalled());
  act(() => result.current.openSubtree('child'));
  rerender({ observation: { ...observed, nodes: observed.nodes.slice(0, 1) } });
  expect(result.current.viewTreeId).toBeUndefined();
  expect(result.current.nodes.map(node => node.id)).toEqual(['root']);
  rerender({ observation: null });
  expect(result.current.viewKey).toBe(editorView);
  expect(result.current.canUndo).toBe(true);
  expect(result.current.nodes).toHaveLength(1);
});
