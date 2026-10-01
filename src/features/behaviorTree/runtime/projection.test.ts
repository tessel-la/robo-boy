import { describe, it, expect } from 'vitest';
import { bindRuntimeProjection, liveSourceNode, projectXml } from './projection';
import type { RuntimeNode, TreeRuntimeId } from './types';

const xml = (
  runtime: TreeRuntimeId
) => `<root ${runtime === 'btcpp' ? 'BTCPP_format="4"' : ''} main_tree_to_execute="Main">
  <BehaviorTree ID="Main"><Sequence memory="true"><SubTree ID="Work" name="first"/><SubTree ID="Work" name="second"/></Sequence></BehaviorTree>
  <BehaviorTree ID="Work"><Sequence><Wait name="same"/><SubTree ID="Nested"/></Sequence></BehaviorTree>
  <BehaviorTree ID="Nested"><Wait name="same" seconds="{delay}"/></BehaviorTree>
</root>`;
function snapshot(runtime: TreeRuntimeId): RuntimeNode[] {
  const node = (id: string, parentId: string | null, status: RuntimeNode['status'] = 'idle'): RuntimeNode => ({
    id,
    parentId,
    status,
    type: 'native',
    label: 'same',
    nativeStatus: status.toUpperCase(),
    feedback: `feedback ${id}`,
  });
  if (runtime === 'py_trees')
    return [
      node('root', null, 'running'),
      node('first', 'root', 'success'),
      node('firstWait', 'first', 'success'),
      node('firstNested', 'first', 'success'),
      node('second', 'root', 'running'),
      node('secondWait', 'second', 'success'),
      node('secondNested', 'second', 'running'),
    ];
  return [
    node('root', null, 'running'),
    node('first', 'root', 'success'),
    node('firstRoot', 'first', 'success'),
    node('firstWait', 'firstRoot', 'success'),
    node('firstNested', 'firstRoot', 'success'),
    node('firstLeaf', 'firstNested', 'success'),
    node('second', 'root', 'running'),
    node('secondRoot', 'second', 'running'),
    node('secondWait', 'secondRoot', 'success'),
    node('secondNested', 'secondRoot', 'running'),
    node('secondLeaf', 'secondNested', 'running'),
  ];
}

describe.each(['btcpp', 'py_trees'] as const)('%s source/runtime projection', runtime => {
  it('keeps the main view collapsed and binds repeated, nested instances by topology', () => {
    const projection = projectXml(xml(runtime), runtime);
    const before = projection.nodes.map(node => node.id);
    const { bindings, error } = bindRuntimeProjection(projection, snapshot(runtime));
    expect(error).toBeNull();
    const main = projection.nodes.map(node => liveSourceNode(node, bindings.get(node.id)));
    expect(main.map(node => node.id)).toEqual(before);
    expect(main.map(node => node.status)).toEqual(['running', 'success', 'running']);
    expect(main.map(node => node.type)).toEqual(['Sequence', 'SubTree', 'SubTree']);
    const secondView = projection.views.get(main[2].subtreeView!)!;
    expect(secondView.treeId).toBe('Work');
    expect(secondView.parent).toBe('main');
    const second = secondView.nodes.map(node => liveSourceNode(node, bindings.get(node.id)));
    expect(second.map(node => node.status)).toEqual(['running', 'success', 'running']);
    const nested = projection.views.get(second[2].subtreeView!)!;
    expect(nested.parent).toBe(main[2].subtreeView);
    const leaf = liveSourceNode(nested.nodes[0], bindings.get(nested.nodes[0].id));
    expect(leaf.status).toBe('running');
    expect(leaf.runtimeId).toBe(runtime === 'btcpp' ? 'secondLeaf' : 'secondNested');
    expect(leaf.feedback).toContain(leaf.runtimeId);
    expect(leaf.attributes.seconds).toBe('{delay}');
    // Reset snapshots clear observed outcomes without changing source identity.
    const reset = bindRuntimeProjection(
      projection,
      snapshot(runtime).map(node => ({ ...node, status: 'idle' }))
    );
    expect(projection.nodes.map(node => liveSourceNode(node, reset.bindings.get(node.id)).status)).toEqual([
      'idle',
      'idle',
      'idle',
    ]);
  });
  it('retains terminal native outcomes and runtime IDs for the node inspector', () => {
    const projection = projectXml(xml(runtime), runtime);
    const nodes = snapshot(runtime).map(node => ({ ...node, status: 'idle' as const, lastResult: 'failure' as const }));
    const { bindings } = bindRuntimeProjection(projection, nodes);
    const source = liveSourceNode(projection.nodes[2], bindings.get(projection.nodes[2].id));
    expect(source.lastResult).toBe('failure');
    expect(source.runtimeId).toBe('second');
    expect(source.subtreeId).toBe('Work');
  });
  it('refuses to misattribute live states when a custom native node changes topology', () => {
    const projection = projectXml(xml(runtime), runtime);
    const nodes = snapshot(runtime);
    nodes.push({ ...nodes[0], id: 'unexpected', parentId: 'root' });
    const result = bindRuntimeProjection(projection, nodes);
    expect(result.error).toContain('topology');
    expect(result.bindings.size).toBe(0);
  });
});
