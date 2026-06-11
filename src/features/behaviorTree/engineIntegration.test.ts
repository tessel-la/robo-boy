import { describe, expect, it } from 'vitest';

import {
  exportTreeAsBtCppXml,
  exportTreeAsYaml,
  getEngineConfig,
  importTreeFromText,
  importTreeFromYaml,
  parseRuntimeNodeCatalogMessage,
  parseRuntimeStatusMessage,
} from './engineIntegration';
import { BehaviorTreeEngine, ExecutionStatus } from './types';

const demoYaml = `name: demo_pick_tree
backend: py_trees
root:
  sequence:
    name: demo_pick_tree
    memory: true
    children:
      - move_relative:
          name: lift
          up: 0.05
      - wait:
          name: settle
          seconds: 0.5
`;

const sequenceYaml = `steps:
  - move_relative:
      up: 0.05
  - wait:
      seconds: 0.5
`;

const duplicateMoveYaml = `name: duplicate_moves
backend: py_trees
root:
  sequence:
    name: Sequence
    children:
      - move_relative:
          name: Move Relative
          up: 0.05
      - move_relative:
          name: Move Relative
          up: -0.05
`;

describe('behavior tree engine integration', () => {
  it('imports manipulator py_trees YAML into editable nodes', () => {
    const tree = importTreeFromYaml(demoYaml);

    expect(tree.name).toBe('demo_pick_tree');
    expect(tree.engine).toBe(BehaviorTreeEngine.PyTrees);
    expect(tree.nodes).toHaveLength(3);
    expect(tree.edges).toHaveLength(2);
    expect(tree.nodes[1].data.externalKind).toBe('move_relative');
    expect(tree.nodes[1].data.externalParams).toMatchObject({ up: 0.05 });
  });

  it('imports manipulator sequence YAML into generated runtime-compatible names', () => {
    const tree = importTreeFromYaml(sequenceYaml);

    expect(tree.nodes.map((node) => node.data.label)).toEqual([
      'Imported Behavior Tree',
      '1_move_relative',
      '2_wait',
    ]);
    expect(tree.nodes[1].data.externalKind).toBe('move_relative');
    expect(tree.nodes[1].data.externalParams).toMatchObject({ up: 0.05 });
  });

  it('falls back to the local engine for unknown saved engine values', () => {
    const config = getEngineConfig({
      id: 'bad-engine',
      name: 'Bad Engine',
      engine: 'old_runtime' as BehaviorTreeEngine,
      nodes: [],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(config.engine).toBe(BehaviorTreeEngine.Local);
  });

  it('rejects non-tree JSON instead of returning catalog payloads as editable trees', () => {
    expect(() => importTreeFromText(JSON.stringify({ trees: [] }), 'catalog.json')).toThrow(
      /nodes array/
    );
  });

  it('exports backend-neutral YAML and BT.CPP XML', () => {
    const tree = importTreeFromYaml(demoYaml);

    expect(exportTreeAsYaml(tree)).toContain('backend: py_trees');
    const xml = exportTreeAsBtCppXml(tree);
    expect(xml).toContain('BTCPP_format="4"');
    expect(xml).toContain('<BehaviorTree ID="demo_pick_tree">');
    expect(xml).toContain('<MoveRelative name="lift" up="0.05" />');
  });

  it('exports duplicate sibling action nodes with unique runtime names', () => {
    const tree = importTreeFromYaml(duplicateMoveYaml);
    const yaml = exportTreeAsYaml(tree);

    expect(yaml).toContain('name: move_relative_node_1');
    expect(yaml).toContain('name: move_relative_node_2');
  });

  it('maps runtime JSON status messages onto graph nodes', () => {
    const tree = importTreeFromYaml(demoYaml);
    const statuses = parseRuntimeStatusMessage(
      { data: JSON.stringify({ nodes: { 'node-1': 'RUNNING', lift: 'SUCCESS' } }) },
      tree.nodes
    );

    expect(statuses.get('node-1')).toBe(ExecutionStatus.Running);
    expect(statuses.get('lift')).toBe(ExecutionStatus.Success);
  });

  it('maps namespaced runtime path statuses back onto editable graph nodes', () => {
    const tree = importTreeFromYaml(demoYaml);
    const statuses = parseRuntimeStatusMessage(
      {
        data: JSON.stringify({
          nodes: {
            demo_pick_tree: 'RUNNING',
            'demo_pick_tree/lift': 'SUCCESS',
            'demo_pick_tree/settle': 'IDLE',
          },
        }),
      },
      tree.nodes
    );

    expect(statuses.get('node-0')).toBe(ExecutionStatus.Running);
    expect(statuses.get('node-1')).toBe(ExecutionStatus.Success);
    expect(statuses.get('node-2')).toBe(ExecutionStatus.Idle);
  });

  it('maps manipulator sequence runtime path statuses after sequence YAML import', () => {
    const tree = importTreeFromYaml(sequenceYaml);
    const statuses = parseRuntimeStatusMessage(
      {
        data: JSON.stringify({
          nodes: {
            'Imported Behavior Tree': 'RUNNING',
            'Imported Behavior Tree/1_move_relative': 'SUCCESS',
            'Imported Behavior Tree/2_wait': 'RUNNING',
          },
        }),
      },
      tree.nodes
    );

    expect(statuses.get('node-0')).toBe(ExecutionStatus.Running);
    expect(statuses.get('node-1')).toBe(ExecutionStatus.Success);
    expect(statuses.get('node-2')).toBe(ExecutionStatus.Running);
  });

  it('maps duplicate exported runtime names back onto separate graph nodes', () => {
    const tree = importTreeFromYaml(duplicateMoveYaml);
    const statuses = parseRuntimeStatusMessage(
      {
        data: JSON.stringify({
          nodes: {
            Sequence: 'RUNNING',
            'Sequence/move_relative_node_1': 'SUCCESS',
            'Sequence/move_relative_node_2': 'RUNNING',
          },
        }),
      },
      tree.nodes
    );

    expect(statuses.get('node-0')).toBe(ExecutionStatus.Running);
    expect(statuses.get('node-1')).toBe(ExecutionStatus.Success);
    expect(statuses.get('node-2')).toBe(ExecutionStatus.Running);
  });

  it('parses generic runtime node catalogs', () => {
    const nodes = parseRuntimeNodeCatalogMessage({
      data: JSON.stringify({
        trees: [
          {
            id: 'main',
            nodes: [
              { id: 'root', name: 'Root', type: 'Sequence', status: 'RUNNING' },
              { id: 'move', name: 'Move', parentId: 'root', status: 'SUCCESS' },
            ],
          },
        ],
      }),
    });

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      id: 'root',
      name: 'Root',
      type: 'Sequence',
      treeId: 'main',
      status: ExecutionStatus.Running,
    });
  });

  it('flattens BT.CPP XML runtime trees into selectable nodes', () => {
    const nodes = parseRuntimeNodeCatalogMessage(
      `<root BTCPP_format="4">
        <BehaviorTree ID="MainTree">
          <Sequence name="root_sequence">
            <ApproachObject name="approach" />
          </Sequence>
        </BehaviorTree>
      </root>`,
      'tree'
    );

    expect(nodes.map((node) => node.name)).toEqual(['root_sequence', 'approach']);
    expect(nodes[1]).toMatchObject({ type: 'approach_object', treeId: 'MainTree' });
  });
});
