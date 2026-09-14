import { describe, expect, it } from 'vitest';
import { parseAssistantResponse } from './responseParser';

const schemas = { actions: {}, services: {} };

describe('parseAssistantResponse', () => {
  it('parses an explanation', () => {
    const response = parseAssistantResponse(JSON.stringify({ kind: 'explanation', message: 'The topic is missing.' }), schemas);
    expect(response).toEqual({ kind: 'explanation', message: 'The topic is missing.' });
  });

  it('parses a clarification with suggestions, capped at four', () => {
    const response = parseAssistantResponse(
      JSON.stringify({ kind: 'clarification', question: 'Which frame?', suggestions: ['a', 'b', 'c', 'd', 'e'] }),
      schemas
    );
    expect(response).toEqual({ kind: 'clarification', question: 'Which frame?', suggestions: ['a', 'b', 'c', 'd'] });
  });

  it('delegates a tree response to the kept treeGeneration parser', () => {
    const response = parseAssistantResponse(
      JSON.stringify({
        kind: 'tree',
        name: 'Generated',
        nodes: [{ id: 'root', type: 'sequence', label: 'Root' }],
        edges: [],
      }),
      schemas
    );
    expect(response.kind).toBe('behaviorTree');
    if (response.kind === 'behaviorTree') expect(response.tree.name).toBe('Generated');
  });

  it('parses and normalizes a Pad proposal', () => {
    const layout = {
      id: 'p1',
      name: 'New Pad',
      gridSize: { width: 4, height: 4 },
      cellSize: 60,
      components: [
        {
          id: 'stick',
          type: 'joystick',
          position: { x: 0, y: 0, width: 2, height: 2 },
          action: { topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' },
        },
      ],
      rosConfig: {},
      metadata: {},
    };
    const response = parseAssistantResponse(JSON.stringify({ kind: 'padProposal', layout }), schemas);
    expect(response.kind).toBe('padProposal');
    if (response.kind !== 'padProposal') return;
    expect(response.layout.components).toHaveLength(1);
    expect(response.layout.components[0].action).toEqual({ topic: '/joy', messageType: 'sensor_msgs/msg/Joy', field: 'axes' });
    // rosConfig and metadata are filled in from the pad's own primary binding.
    expect(response.layout.rosConfig).toEqual({ defaultTopic: '/joy', defaultMessageType: 'sensor_msgs/msg/Joy' });
    expect(response.layout.metadata.version).toBe('1.0.0');
  });

  it('rejects a Pad proposal with no components array', () => {
    expect(() => parseAssistantResponse(JSON.stringify({ kind: 'padProposal', layout: { id: 'p1' } }), schemas)).toThrow(
      /must contain a components array/
    );
  });

  it('parses a ROS action proposal', () => {
    const response = parseAssistantResponse(
      JSON.stringify({
        kind: 'rosAction',
        operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist', payload: {} },
        rationale: 'Move forward.',
      }),
      schemas
    );
    expect(response).toEqual({
      kind: 'rosAction',
      operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/Twist', payload: {} },
      rationale: 'Move forward.',
      issues: [],
    });
  });

  it('rejects a ROS action proposal missing a name or type', () => {
    expect(() =>
      parseAssistantResponse(JSON.stringify({ kind: 'rosAction', operation: { kind: 'topic', name: '/cmd_vel' } }), schemas)
    ).toThrow(/invalid ROS action/);
  });

  it('rejects an unrecognized kind', () => {
    expect(() => parseAssistantResponse(JSON.stringify({ kind: 'unknown-thing' }), schemas)).toThrow(/unrecognized response kind/);
  });

  it('rejects non-JSON text with a clear error', () => {
    expect(() => parseAssistantResponse('not json at all', schemas)).toThrow(/did not return valid JSON/);
  });

  it('strips a markdown code fence before parsing', () => {
    const response = parseAssistantResponse('```json\n{"kind":"explanation","message":"ok"}\n```', schemas);
    expect(response).toEqual({ kind: 'explanation', message: 'ok' });
  });
});
