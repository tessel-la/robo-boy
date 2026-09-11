import { describe, expect, it } from 'vitest';
import { ASSISTANT_CAPABILITIES, composeAssistantSystemPrompt } from './prompt';
import { CONTEXT_CATALOG } from './capabilities';
import type { AssistantAutoContext, AssistantContextChip } from './types';

const autoContext = (overrides: Partial<AssistantAutoContext> = {}): AssistantAutoContext => ({
  workspace: { connectionStatus: 'connected', openPanels: [], selectedPadLayoutId: null, openBehaviorTreeId: null, savedLayouts: [], fetchedAt: Date.now() },
  padLibrary: [],
  behaviorTreeLibrary: [],
  ...overrides,
});

const compose = (input: Partial<Parameters<typeof composeAssistantSystemPrompt>[0]> = {}) =>
  composeAssistantSystemPrompt({
    settings: { systemContext: '', robotContext: '' },
    autoContext: autoContext(),
    pinnedChips: [],
    needs: { behaviorTree: false, pad: false, rosAction: false },
    ...input,
  });

describe('composeAssistantSystemPrompt', () => {
  /**
   * Without a capability section the model answers from general ROS knowledge: asked whether
   * Robo-Boy can measure the distance between two frames it replied "write a tf2_ros node", for
   * something the app already computes from live /tf before the provider is even called.
   */
  it('renders every declared capability, so adding one reaches the model without editing prose', () => {
    const prompt = compose();

    for (const capability of ASSISTANT_CAPABILITIES) {
      expect(prompt).toContain(capability.summary);
      for (const detail of capability.detail ?? []) expect(prompt).toContain(detail);
      for (const invocation of capability.invocations ?? []) expect(prompt).toContain(`"${invocation}"`);
    }
  });

  it('lists exactly the resources `@` can pull live, and says the rest is already there', () => {
    const prompt = compose();

    for (const entry of CONTEXT_CATALOG) expect(prompt).toContain(`- ${entry.label}: ${entry.provides}`);
    expect(prompt).toMatch(/Everything the app holds is already below/);
    expect(prompt).toMatch(/never ask the user to paste one/);
  });

  it('never tells the user to leave the app for something it does itself', () => {
    expect(compose()).toMatch(/Never tell the user to write a script, launch a node, or run a CLI/);
  });

  it('carries only the domain fragments a turn needs', () => {
    const plain = compose();
    expect(plain).not.toContain('## Pad tool');

    const pad = compose({ needs: { behaviorTree: false, pad: true, rosAction: false } });
    expect(pad).toContain('## Pad tool');
    expect(pad).toContain('The key is "topic", never "topicName"');
  });

  it('marks a stale ROS graph rather than presenting it as current', () => {
    const fresh = compose({
      autoContext: autoContext({ ros: { resources: { topics: [], services: [], actions: [] } as never, fetchedAt: Date.now(), generation: 1, stale: false } }),
    });
    expect(fresh).not.toContain('STALE');

    const stale = compose({
      autoContext: autoContext({ ros: { resources: { topics: [], services: [], actions: [] } as never, fetchedAt: Date.now(), generation: 0, stale: true } }),
    });
    expect(stale).toContain('STALE');
  });

  it('says plainly when there is no ROS graph, so names are not invented', () => {
    expect(compose()).toMatch(/Unavailable — no ROS connection.*Do not invent any/s);
  });

  it('gives each tagged item its source and age', () => {
    const chip: AssistantContextChip = {
      id: 'ros:topic:/cmd_vel',
      label: 'Topic: /cmd_vel',
      source: 'ros',
      automatic: false,
      fetchedAt: Date.now() - 12_000,
      stale: true,
      value: { schema: {} },
    };

    const prompt = compose({ pinnedChips: [chip] });

    expect(prompt).toContain('### Topic: /cmd_vel [source: ros, fetched 12s ago (stale');
    expect(prompt).toContain('## Items the user explicitly pinned for this turn');
  });

  it('includes the user\'s own instructions when they set them', () => {
    const prompt = compose({ settings: { systemContext: 'Answer in metric units.', robotContext: 'Two-wheeled rover.' } });

    expect(prompt).toContain('Additional assistant instructions:\nAnswer in metric units.');
    expect(prompt).toContain('Robot and mission context:\nTwo-wheeled rover.');
  });
});
