import { describe, expect, it } from 'vitest';
import { BehaviorNodeType } from '../types';
import { parseGeneratedAgentResponse, parseGeneratedBehaviorTree } from './treeGeneration';

describe('parseGeneratedBehaviorTree', () => {
  it('normalizes a generated tree and preserves edge order', () => {
    const tree = parseGeneratedBehaviorTree(JSON.stringify({
      name: 'Inspect',
      nodes: [
        { id: 'root', type: 'sequence', label: 'Mission' },
        { id: 'navigate', type: 'action', label: 'Navigate', config: { actionName: '/navigate', actionType: 'nav2_msgs/action/NavigateToPose', parameters: { speed: 1 } } },
        { id: 'capture', type: 'service', label: 'Capture', config: { serviceName: '/capture', serviceType: 'camera/srv/Capture' } },
      ],
      edges: [
        { source: 'root', target: 'navigate' },
        { source: 'root', target: 'capture' },
      ],
    }));

    expect(tree.name).toBe('Inspect');
    expect(tree.nodes).toHaveLength(3);
    expect(tree.nodes[1].type).toBe(BehaviorNodeType.Action);
    expect(tree.edges.map(edge => edge.target)).toEqual(['navigate', 'capture']);
    expect(tree.nodes.find(node => node.id === 'navigate')?.data).toMatchObject({
      actionName: '/navigate',
      actionType: 'nav2_msgs/action/NavigateToPose',
    });
  });

  it('normalizes nested subtrees', () => {
    const tree = parseGeneratedBehaviorTree(`\`\`\`json
      {"name":"Root","nodes":[{"id":"sub","type":"subtree","label":"Recovery","tree":{"name":"Recovery","nodes":[{"id":"wait","type":"topic","config":{"topicName":"/wait","messageType":"std_msgs/msg/Bool"}}],"edges":[]}}],"edges":[]}
    \`\`\``);
    const subtree = tree.nodes[0].data;
    expect('tree' in subtree && subtree.tree.name).toBe('Recovery');
  });

  it('rejects missing edge endpoints', () => {
    expect(() => parseGeneratedBehaviorTree(JSON.stringify({
      name: 'Broken',
      nodes: [{ id: 'root', type: 'sequence' }],
      edges: [{ source: 'root', target: 'missing' }],
    }))).toThrow('references a missing node');
  });

  it('fills action defaults from discovered schemas and keeps requested values', () => {
    const tree = parseGeneratedBehaviorTree(JSON.stringify({
      name: 'Move',
      nodes: [{
        id: 'move', type: 'action',
        config: {
          actionName: '/move',
          actionType: 'robot/action/Move',
          parameters: { x: 0.5, y: -0.2, target: { x: 2 } },
        },
      }],
      edges: [],
    }), {
      actions: {
        'robot/action/Move': {
          fields: [],
          defaults: { relative: false, x: 0, y: 0, z: 0, yaw: 0, timeout: 10, target: { x: 0, y: 0 } },
        },
      },
      services: {},
    });

    expect(tree.nodes[0].data).toMatchObject({
      parameters: { relative: false, x: 0.5, y: -0.2, z: 0, yaw: 0, timeout: 10, target: { x: 2, y: 0 } },
    });
  });

  it('parses a clarification response', () => {
    expect(parseGeneratedAgentResponse(JSON.stringify({
      kind: 'clarification',
      question: 'How far should the robot move on x and y?',
      missing: ['x', 'y'],
      suggestions: ['x 0.5 m, y 0 m'],
    }))).toEqual({
      kind: 'clarification',
      question: 'How far should the robot move on x and y?',
      missing: ['x', 'y'],
      suggestions: ['x 0.5 m, y 0 m'],
    });
  });
});
