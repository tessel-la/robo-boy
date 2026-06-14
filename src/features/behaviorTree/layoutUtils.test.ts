import { Edge } from 'reactflow';

import { arrangeBehaviorTree } from './layoutUtils';
import { BehaviorNodeType, BehaviorTreeNode } from './types';

const node = (id: string): BehaviorTreeNode => ({
  id,
  type: BehaviorNodeType.Action,
  position: { x: 999, y: 999 },
  data: { label: id, actionName: `/${id}`, actionType: 'example_msgs/action/Run' },
});

describe('behavior tree layout utilities', () => {
  it('lays out children below their parent in edge order', () => {
    const nodes = [node('root'), node('second'), node('first')];
    const edges: Edge[] = [
      { id: 'edge-first', source: 'root', target: 'first' },
      { id: 'edge-second', source: 'root', target: 'second' },
    ];

    const arranged = arrangeBehaviorTree(nodes, edges);
    const byId = new Map(arranged.map(item => [item.id, item]));

    expect(byId.get('root')?.position.y).toBe(0);
    expect(byId.get('first')?.position.y).toBeGreaterThan(0);
    expect(byId.get('first')?.position.x).toBeLessThan(byId.get('second')?.position.x ?? 0);
    expect(byId.get('root')?.position.x).toBeGreaterThan(byId.get('first')?.position.x ?? 0);
    expect(byId.get('root')?.position.x).toBeLessThan(byId.get('second')?.position.x ?? 0);
  });

  it('places disconnected trees beside each other', () => {
    const arranged = arrangeBehaviorTree([node('one'), node('two')], []);

    expect(arranged[0].position.y).toBe(0);
    expect(arranged[1].position.y).toBe(0);
    expect(arranged[1].position.x).toBeGreaterThan(arranged[0].position.x);
  });

  it('handles cycles without dropping or duplicating nodes', () => {
    const edges: Edge[] = [
      { id: 'edge-a', source: 'a', target: 'b' },
      { id: 'edge-b', source: 'b', target: 'a' },
    ];

    const arranged = arrangeBehaviorTree([node('a'), node('b')], edges);

    expect(arranged.map(item => item.id)).toEqual(['a', 'b']);
    expect(arranged.every(item => Number.isFinite(item.position.x))).toBe(true);
    expect(arranged.every(item => Number.isFinite(item.position.y))).toBe(true);
  });
});
