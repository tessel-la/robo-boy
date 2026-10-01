import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeTreeController, projectXml } from './useNativeTreeController';
import { nativeTreeFromXml, treeFormats } from './xml';
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
    expect(result.current.nodes).toEqual(runtime.state.session.nodes);
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
});
