import type { AssistantResponse } from './types';

/**
 * What the assistant can actually do, declared as data next to nothing in particular so each
 * feature can own its own entry.
 *
 * The model has to be told this: left to general ROS knowledge it answers "write a tf2_ros node"
 * for a transform the app computes from live `/tf` before a provider is even called. Writing that
 * as prose inside the prompt is what rots — the prose says one thing, the code does another, and
 * nothing fails. So a capability is a record instead, declared beside the code that implements it,
 * rendered into the prompt here, and checked against that code by `capabilities.test.ts`:
 *
 * - `invocations` are real user phrasings; the test feeds each to the parser that must match it.
 * - `responseKind` is a discriminator the response parser must still accept.
 *
 * Delete a feature and its capability goes with it. Change how it is triggered without updating
 * `invocations` and the test fails rather than the assistant quietly lying to a user.
 */
export interface AssistantCapability {
  id: string;
  /** One line, imperative, addressed to the model. */
  summary: string;
  /** Extra lines the model needs to route the user correctly. */
  detail?: string[];
  /** Phrasings that trigger this capability, verbatim enough for the model to quote back. */
  invocations?: string[];
  /** The structured response `kind` this capability produces, if it produces one. */
  responseKind?: AssistantResponse['kind'];
}

/**
 * One entry per group in the `@`/Context browser. The picker builds its sections from these labels
 * and the prompt lists the same set, so "what the user can tag" cannot say one thing in the UI and
 * another to the model.
 */
export interface ContextCatalogEntry {
  id: 'automatic' | 'bulk' | 'workspace' | 'open' | 'pads' | 'trees' | 'topics' | 'services' | 'actions' | 'nodes' | 'parameters' | 'tf-diagnostics';
  /** Heading shown in the Context browser. */
  label: string;
  /** What tagging one of these actually puts in the prompt. */
  provides: string;
}

export const CONTEXT_CATALOG: readonly ContextCatalogEntry[] = [
  { id: 'automatic', label: 'Always included', provides: 'the workspace snapshot and ROS graph the assistant reads on its own, every turn' },
  { id: 'bulk', label: 'Everything', provides: 'whole libraries at once — every Pad and panel, every Behavior Tree, or all of it with the saved layouts — for a question that spans them' },
  { id: 'workspace', label: 'Current workspace', provides: 'an open panel, the current layout, or a saved layout' },
  { id: 'open', label: 'Open and selected', provides: 'the Pad or Behavior Tree open right now, as complete JSON' },
  { id: 'pads', label: 'Pads', provides: 'any saved Pad, as complete JSON' },
  { id: 'trees', label: 'Behavior Trees', provides: 'any saved Behavior Tree, as complete JSON' },
  { id: 'topics', label: 'ROS topics', provides: 'a topic\'s message schema plus a bounded live sample' },
  { id: 'services', label: 'ROS services', provides: 'a service\'s request schema' },
  { id: 'actions', label: 'ROS actions', provides: 'an action\'s goal schema' },
  { id: 'nodes', label: 'ROS nodes', provides: 'a node\'s publishers, subscribers and services' },
  { id: 'parameters', label: 'ROS parameters', provides: 'a parameter\'s current value' },
  { id: 'tf-diagnostics', label: 'TF and diagnostics', provides: 'a TF tree snapshot, or a bounded /rosout capture' },
] as const;

/** Renders the registry into the section of the system prompt that describes the app itself. */
export const describeCapabilities = (capabilities: readonly AssistantCapability[]): string => {
  const lines = capabilities.map(capability => {
    const parts = [`- ${capability.summary}`];
    for (const detail of capability.detail ?? []) parts.push(`  ${detail}`);
    if (capability.invocations?.length) {
      parts.push(`  The user triggers this by asking, for example: ${capability.invocations.map(phrase => `"${phrase}"`).join(', ')}.`);
    }
    return parts.join('\n');
  });

  const catalog = CONTEXT_CATALOG.map(entry => `  - ${entry.label}: ${entry.provides}`).join('\n');

  return [
    '## What Robo-Boy can do for the user',
    'You are inside the app, not beside it. Never tell the user to write a script, launch a node, or run a CLI for anything below; tell them the in-app way instead.',
    '',
    lines.join('\n'),
    '',
    '- The user can tag exact data into the conversation by typing `@` or opening the Context browser:',
    catalog,
    '  If a question needs data you were not given, name the exact resource and ask them to tag it, rather than guessing or saying you have no access.',
  ].join('\n');
};
