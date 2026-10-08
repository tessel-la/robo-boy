import { describe, expect, it } from 'vitest';
import { validateTreeBindings, validateTreeStructure } from './treeValidation';
import type { BehaviorTree, ROSDiscoveryResult } from '../../behaviorTree/types';
import type { BehaviorTreeResourceSchemas } from '../../behaviorTree/agent/types';

const node = (id: string, type = 'sequence', data: Record<string, unknown> = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { label: id, type: 'sequence' as const, ...data },
});
const tree = (nodes: BehaviorTree['nodes'], edges: BehaviorTree['edges'] = []): BehaviorTree => ({
  id: 'test-tree',
  name: 'Test',
  nodes,
  edges,
  createdAt: 1,
  updatedAt: 1,
});
const graph: ROSDiscoveryResult = {
  topics: [{ name: '/state', type: 'State' }],
  services: [{ name: '/configure', type: 'Configure' }],
  actions: [{ name: '/navigate', type: 'Navigate', namespace: '/' }],
};
const schema = { fields: [{ name: 'enabled', rosType: 'bool', arrayLen: -1 }], defaults: { enabled: false } };
const schemas: BehaviorTreeResourceSchemas = { actions: { Navigate: schema }, services: { Configure: schema } };

describe('authoring tree validation', () => {
  it('accepts a valid graph and rejects unknown endpoints, duplicate ids and malformed nodes', () => {
    expect(
      validateTreeStructure(
        tree([node('root'), node('leaf', 'condition')], [{ id: 'edge', source: 'root', target: 'leaf' }])
      )
    ).toEqual([]);
    const errors = validateTreeStructure(
      tree([node('root'), node('root', 'unknown')], [{ id: 'edge', source: 'root', target: 'missing' }])
    );
    expect(errors).toContain('Node ids must be unique.');
    expect(errors).toContain('Invalid node root.');
    expect(errors).toContain('An edge references an unknown node.');
    expect(validateTreeStructure(tree([{ ...node('bad'), position: { x: NaN, y: 0 } }]))).toContain(
      'Invalid node bad.'
    );
  });
  it('finds disconnected cycles and bounds the graph before traversing it', () => {
    const cyclic = tree(
      [node('root'), node('a'), node('b')],
      [
        { id: 'ab', source: 'a', target: 'b' },
        { id: 'ba', source: 'b', target: 'a' },
      ]
    );
    expect(validateTreeStructure(cyclic)).toContain('Behavior trees cannot contain cycles.');
    expect(validateTreeStructure(tree(Array.from({ length: 501 }, (_, i) => node(String(i)))))).toEqual([
      'Invalid or oversized tree graph.',
    ]);
    expect(validateTreeStructure({ ...tree([]), edges: null } as unknown as BehaviorTree)).toEqual([
      'Invalid or oversized tree graph.',
    ]);
  });
  it('requires observed exact interfaces and retrieved action/service schemas', () => {
    const value = tree([
      node('action', 'action', { actionName: '/navigate', actionType: 'Navigate', parameters: { enabled: true } }),
      node('service', 'service', { serviceName: '/configure', serviceType: 'Configure', request: { enabled: false } }),
      node('topic', 'topic', { topicName: '/state', messageType: 'State' }),
      node('subscriber', 'subscriber', { topicName: '/state', messageType: 'State' }),
    ]);
    expect(validateTreeBindings(value, graph, schemas)).toEqual([]);
    expect(validateTreeBindings(value, null, { actions: {}, services: {} })).toEqual(
      expect.arrayContaining([
        expect.stringContaining('retrieve the connected action interface'),
        expect.stringContaining('retrieve the connected service interface'),
        expect.stringContaining('retrieve the connected topic interface'),
        expect.stringContaining('read the action schema'),
        expect.stringContaining('read the service schema'),
      ])
    );
  });
  it('rejects unknown or incompatible payload fields and checks nested trees', () => {
    const invalid = tree([
      node('action', 'action', {
        actionName: '/navigate',
        actionType: 'Navigate',
        parameters: { enabled: 'yes', unexpected: true },
      }),
    ]);
    const errors = validateTreeBindings(tree([node('nested', 'subtree', { tree: invalid })]), graph, schemas);
    expect(errors).toContain('action: enabled must be a boolean.');
    expect(errors).toContain('action: Unknown ROS field unexpected.');
    expect(
      validateTreeBindings(
        tree([node('service', 'service', { serviceName: '/configure', serviceType: 'Configure' })]),
        graph,
        schemas
      )
    ).toEqual([]);
  });
  it('bounds subtree recursion and reported errors', () => {
    let nested = tree([node('leaf', 'condition')]);
    for (let depth = 0; depth < 12; depth++) nested = tree([node(`sub-${depth}`, 'subtree', { tree: nested })]);
    expect(validateTreeBindings(nested, graph, schemas)).toContain('Subtree nesting exceeds ten levels.');
    const many = tree(
      Array.from({ length: 60 }, (_, i) => node(String(i), 'action', { actionName: '/missing', actionType: 'Missing' }))
    );
    expect(validateTreeBindings(many, graph, schemas)).toHaveLength(40);
  });
});
