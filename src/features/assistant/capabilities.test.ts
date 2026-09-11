import { describe, expect, it } from 'vitest';
import { ASSISTANT_CAPABILITIES } from './prompt';
import { CONTEXT_CATALOG } from './capabilities';
import { parseDistanceRequest, parseTransformRequest, TF_CAPABILITY } from './context/tfContext';
import { parseAssistantResponse } from './responseParser';

/**
 * The capability registry is what the assistant tells users it can do. Prose in a prompt drifts
 * silently from the code it describes — the assistant keeps promising something that no longer
 * works, or stops mentioning something that does, and nothing fails. These tests are the link:
 * each declaration is checked against the implementation it claims.
 */
describe('assistant capability registry', () => {
  it('declares a unique, non-empty entry per capability', () => {
    const ids = ASSISTANT_CAPABILITIES.map(capability => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const capability of ASSISTANT_CAPABILITIES) expect(capability.summary.trim().length).toBeGreaterThan(0);
  });

  it('offers only TF phrasings the TF parsers actually recognise', () => {
    expect(TF_CAPABILITY.invocations?.length).toBeGreaterThan(0);

    for (const phrase of TF_CAPABILITY.invocations ?? []) {
      const parsed = parseDistanceRequest(phrase) ?? parseTransformRequest(phrase);
      expect(parsed, `"${phrase}" is offered to users but no TF parser matches it`).not.toBeNull();
      expect(parsed!.sourceFrame.length).toBeGreaterThan(0);
      expect(parsed!.targetFrame.length).toBeGreaterThan(0);
    }
  });

  it('resolves each TF phrasing to the two frames it names', () => {
    expect(parseDistanceRequest('distance between base_link and camera_link')).toEqual({
      sourceFrame: 'base_link',
      targetFrame: 'camera_link',
    });
    expect(parseTransformRequest('transform from odom to base_link')).toEqual({
      sourceFrame: 'odom',
      targetFrame: 'base_link',
    });
  });

  it('names only response kinds the parser still accepts', () => {
    const sample: Record<string, unknown> = {
      padProposal: {
        kind: 'padProposal',
        layout: { name: 'Pad', components: [{ type: 'button', label: 'Go', action: { topic: '/go', messageType: 'std_msgs/msg/Bool' } }] },
      },
      behaviorTree: { kind: 'tree', name: 'Tree', nodes: [{ id: 'a', type: 'sequence', label: 'Root' }], edges: [] },
      rosAction: {
        kind: 'rosAction',
        operation: { kind: 'topic', name: '/cmd_vel', messageType: 'geometry_msgs/msg/Twist', payload: {} },
        rationale: 'why',
      },
    };

    for (const capability of ASSISTANT_CAPABILITIES) {
      if (!capability.responseKind) continue;
      const payload = sample[capability.responseKind];
      expect(payload, `no sample for declared response kind "${capability.responseKind}"`).toBeDefined();
      const parsed = parseAssistantResponse(JSON.stringify(payload), { actions: {}, services: {} });
      expect(parsed.kind).toBe(capability.responseKind);
    }
  });

  it('describes a context group for every id the picker can build', () => {
    const ids = CONTEXT_CATALOG.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CONTEXT_CATALOG) {
      expect(entry.label.trim().length).toBeGreaterThan(0);
      expect(entry.provides.trim().length).toBeGreaterThan(0);
    }
  });
});
