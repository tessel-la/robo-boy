import { describe, expect, it } from 'vitest';
import { buildBehaviorTreeAgentPrompt } from './agentClient';
import { getDefaultAgentSettings } from './agentStorage';

describe('buildBehaviorTreeAgentPrompt', () => {
  it('directs the model to infer routine movement values autonomously', () => {
    const prompt = buildBehaviorTreeAgentPrompt({
      prompt: 'Move forward and inspect.',
      settings: getDefaultAgentSettings(),
      currentTree: null,
      rosResources: { actions: [], services: [], topics: [] },
      resourceSchemas: { actions: {}, services: {} },
    });

    expect(prompt).toContain('act autonomously');
    expect(prompt).toContain('set unspecified displacement axes to 0');
    expect(prompt).toContain('Never ask about a field that has a schema default');
    expect(prompt).toContain('Ask at most once in the entire conversation');
  });
});
