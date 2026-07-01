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

  it('preserves dev runtime nodes, blackboard bindings, and if/else handles', () => {
    const tree = parseGeneratedBehaviorTree(JSON.stringify({
      name: 'Reactive mission',
      blackboardDefaults: { obstacle: false },
      nodes: [
        { id: 'watch', type: 'subscriber', config: { topicName: '/obstacle', messageType: 'std_msgs/msg/Bool', timeout: 5000, outputBindings: [{ sourcePath: 'data', variable: 'obstacle' }] } },
        { id: 'branch', type: 'ifElse', config: { variable: 'obstacle', operator: 'truthy' } },
        { id: 'stop', type: 'topic', config: { topicName: '/cmd', messageType: 'std_msgs/msg/String', message: { data: 'stop' } } },
        { id: 'continue', type: 'timeout', config: { timeout: 2500 } },
      ],
      edges: [
        { source: 'watch', target: 'branch' },
        { source: 'branch', target: 'stop', sourceHandle: 'then' },
        { source: 'branch', target: 'continue', sourceHandle: 'else' },
      ],
    }));

    expect(tree.blackboardDefaults).toEqual({ obstacle: false });
    expect(tree.nodes.find(node => node.id === 'watch')?.data).toMatchObject({
      timeout: 5000,
      outputBindings: [{ sourcePath: 'data', variable: 'obstacle' }],
    });
    expect(tree.nodes.find(node => node.id === 'continue')?.data).toMatchObject({ timeout: 2500 });
    expect(tree.edges.map(edge => edge.sourceHandle)).toEqual([null, 'then', 'else']);
  });

  it('normalizes fallback ids, labels, control defaults, and raw runtime fields', () => {
    const tree = parseGeneratedBehaviorTree(JSON.stringify({
      id: '',
      nodes: [
        { type: 'retry', config: { description: 'try again' } },
        { id: 'node-0', type: 'repeat', label: 'Loop', config: { iterationLimit: 4 } },
        { id: 'wait', type: 'timeout', config: { timeout: 'bad' } },
        { id: 'branch', type: 'ifElse', variable: 'ready', operator: 'exists', expectedValue: true },
        { id: 'service', type: 'service', serviceName: '/capture', serviceType: 'camera/srv/Capture', request: { quality: 80 } },
        { id: 'topic', type: 'topic', config: { topicName: '/cmd', messageType: 'std_msgs/msg/String', message: { data: 'go' }, inputBindings: [{ variable: 'speed', targetPath: 'linear.x' }] } },
      ],
      edges: [],
    }), {
      actions: {},
      services: {
        'camera/srv/Capture': {
          fields: [],
          defaults: { quality: 50, format: 'jpg' },
        },
      },
    });

    expect(tree.name).toBe('AI generated tree');
    expect(tree.nodes.map(node => node.id)).toEqual(['node-0', 'node-0-1', 'wait', 'branch', 'service', 'topic']);
    expect(tree.nodes[0].data).toMatchObject({ label: 'retry', iterationLimit: 3, description: 'try again' });
    expect(tree.nodes[1].data).toMatchObject({ label: 'Loop', iterationLimit: 4 });
    expect(tree.nodes[2].data).toMatchObject({ timeout: 10000 });
    expect(tree.nodes[3].data).toMatchObject({ variable: 'ready', operator: 'exists', expectedValue: true });
    expect(tree.nodes[4].data).toMatchObject({ request: { quality: 80, format: 'jpg' } });
    expect(tree.nodes[5].data).toMatchObject({ inputBindings: [{ variable: 'speed', targetPath: 'linear.x' }] });
  });

  it('rejects malformed agent responses with actionable errors', () => {
    expect(() => parseGeneratedBehaviorTree('not json')).toThrow('valid JSON');
    expect(() => parseGeneratedBehaviorTree(JSON.stringify({ nodes: [] }))).toThrow('nodes and edges arrays');
    expect(() => parseGeneratedBehaviorTree(JSON.stringify({
      nodes: [{ id: 'bad', type: 'condition' }],
      edges: [],
    }))).toThrow('unsupported type "condition"');
    expect(() => parseGeneratedBehaviorTree(JSON.stringify({
      nodes: [{ id: 'a', type: 'sequence' }],
      edges: [{ source: 'a', target: 'a' }],
    }))).toThrow('no root node');
    expect(() => parseGeneratedAgentResponse(JSON.stringify({
      kind: 'clarification',
      question: '   ',
    }))).toThrow('empty clarification question');
  });

  it('limits clarification suggestions and coerces missing fields to strings', () => {
    expect(parseGeneratedAgentResponse(JSON.stringify({
      kind: 'clarification',
      question: 'Which frame?',
      missing: ['frame', 42],
      suggestions: ['map', 'odom', 'base_link', 'camera', 'too many'],
    }))).toEqual({
      kind: 'clarification',
      question: 'Which frame?',
      missing: ['frame', '42'],
      suggestions: ['map', 'odom', 'base_link', 'camera'],
    });
  });
});
