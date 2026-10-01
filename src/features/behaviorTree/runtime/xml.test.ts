import { describe, it, expect } from 'vitest';
import { inspectXml, nativeTreeFromXml, treeFormats, validateDocument } from './xml';

const cpp = treeFormats[0].template;
const py = treeFormats[1].template;
describe('Native XML format adapters', () => {
  it('identifies explicit C++ format and requires a choice for shared XML syntax', () => {
    expect(inspectXml(cpp).runtime).toBe('btcpp');
    expect(inspectXml(py).runtime).toBeNull();
    expect(inspectXml(py, 'py_trees').runtime).toBe('py_trees');
    expect(() => validateDocument({ xml: py, runtime: null })).toThrow('Choose');
  });
  it('preserves all original source and backend metadata', () => {
    const source = cpp.replace(
      '</root>',
      '<TreeNodesModel><Action ID="Custom"><input_port name="thing"/></Action></TreeNodesModel><!-- keep --></root>'
    );
    const saved = nativeTreeFromXml(source);
    expect(saved.nativeDocument?.xml).toBe(source);
    expect(saved.nodes).toEqual([]);
    expect(saved.nativeDocument?.mainTreeId).toBe('Main');
  });
  it('rejects invalid XML, entities, imports, cycles, missing IDs and extra roots', () => {
    for (const source of [
      '<root>',
      '<wrong/>',
      '<root/>',
      '<!DOCTYPE root><root/>',
      cpp.replace('<Wait name="Wait" seconds="0.5"/>', '<Include file="/etc/passwd"/>'),
      cpp.replace('<Wait name="Wait" seconds="0.5"/>', '<SubTree ID="Main"/>'),
      py.replace('<Wait name="Wait" seconds="0.5"/>', '<subtree ID="Main"/>'),
      cpp.replace('ID="Main"', 'ID="Other"'),
      cpp.replace('</BehaviorTree>', '<AlwaysSuccess/></BehaviorTree>'),
    ]) {
      expect(() => inspectXml(source)).toThrow();
    }
  });
  it('does not silently reinterpret one runtime as another', () => {
    expect(() => inspectXml(cpp, 'py_trees')).toThrow('BehaviorTree.CPP');
    expect(() => inspectXml(py, 'btcpp')).toThrow('BTCPP_format');
  });
  it('supports multiple subtrees and explicit main selection', () => {
    const source =
      '<root BTCPP_format="4" main_tree_to_execute="Main"><BehaviorTree ID="Main"><SubTree ID="Child" key="{answer}"/></BehaviorTree><BehaviorTree ID="Child"><AlwaysSuccess/></BehaviorTree></root>';
    expect(inspectXml(source).trees).toHaveLength(2);
    expect(inspectXml(source, 'btcpp', 'Child').mainTreeId).toBe('Child');
  });
  it('infers a single main tree and requires an explicit choice among multiple roots', () => {
    expect(inspectXml(cpp.replace(' main_tree_to_execute="Main"', '')).mainTreeId).toBe('Main');
    const source = cpp
      .replace(' main_tree_to_execute="Main"', '')
      .replace('</root>', '<BehaviorTree ID="Other"><AlwaysFailure/></BehaviorTree></root>');
    const tree = nativeTreeFromXml(source);
    expect(() => validateDocument(tree.nativeDocument!)).toThrow('Choose the main');
    expect(validateDocument({ ...tree.nativeDocument!, mainTreeId: 'Other' }).mainTreeId).toBe('Other');
  });
});
