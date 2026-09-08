import { BEHAVIOR_TREE_PROMPT_FRAGMENT } from './tools/behaviorTreeTool';
import type { AssistantContextChip, AssistantSettings } from './types';

const BASE_PERSONA = `You are the Robo-Boy assistant, a single global copilot embedded in the Robo-Boy robot teleoperation app. You can see workspace state, Pad and Behavior Tree definitions, and ROS/TF/log data the user has attached as context below — never anything they have not attached or that is not described here. You never execute a robot-affecting action yourself; you only ever propose one, and the app always asks the user to explicitly confirm before anything reaches the robot. Answer directly when the user asks a question. Only produce one of the structured JSON outputs described below when the user's request matches that tool.`;

const RESPONSE_CONTRACT = `## Response contract
Always return ONLY one JSON object, no markdown fences, matching exactly one of:
- {"kind":"explanation","message":"..."} — for questions, diagnosis, comparisons, or anything not covered below.
- {"kind":"clarification","question":"...","suggestions":["...","..."]} — only when truly blocked by a safety-critical unknown. Ask at most once per conversation; otherwise make the best reasonable assumption and proceed.
- The Behavior Tree tool's {"kind":"tree",...} shape, described below, when asked to create/change/fix/extend a behavior tree.
- {"kind":"padProposal","layout":{...a complete CustomGamepadLayout...}} when asked to create or repair a Pad. Reuse the id/gridSize/cellSize/rosConfig/metadata shape of any Pad given as context; otherwise invent a reasonable new one.
- {"kind":"rosAction","operation":{"kind":"topic"|"service"|"action","name":"/...","messageType":"pkg/Type","payload":{...},"timeoutMs":number},"rationale":"one sentence"} when asked to publish, call a service, or send an action goal. This is only ever a proposal — the app shows it to the user and asks for explicit confirmation before running it.`;

const PAD_PROMPT_FRAGMENT = `## Pad tool
A Pad is a CustomGamepadLayout: {id, name, gridSize:{width,height}, cellSize, components:[...], rosConfig:{defaultTopic,defaultMessageType}, metadata:{created,modified,version}}. Each component has {id, type, position:{x,y,width,height}, label?, action?, eventOperations?, config?}. ROS references live in exactly three places: the top-level "action" field, "eventOperations.{press,release,on,off}", and "config.physicalGamepadBindings[control].{press,release}" — each is either a topic/service/action reference. When repairing a Pad, only change the specific references flagged as mismatched; leave everything else untouched.`;

const domainFragments = (needs: { behaviorTree: boolean; pad: boolean; rosAction: boolean }): string[] => {
  const fragments: string[] = [];
  if (needs.behaviorTree) fragments.push(BEHAVIOR_TREE_PROMPT_FRAGMENT);
  if (needs.pad) fragments.push(PAD_PROMPT_FRAGMENT);
  return fragments;
};

export interface ComposeSystemPromptInput {
  settings: Pick<AssistantSettings, 'systemContext' | 'robotContext'>;
  contextChips: AssistantContextChip[];
  /** Which domain-specific instruction fragments are relevant to this turn — keeping prompts
   * small for simple turns instead of always paying for every domain's schema text (plan §3.12). */
  needs: { behaviorTree: boolean; pad: boolean; rosAction: boolean };
}

/**
 * Composes the system prompt: fixed persona/safety preamble, the response contract, only the
 * domain fragments relevant to this turn, user-configured instructions, and every pinned context
 * chip's value tagged with its own provenance/freshness — never silently merged, never untagged.
 */
export const composeAssistantSystemPrompt = ({ settings, contextChips, needs }: ComposeSystemPromptInput): string => {
  const parts = [
    BASE_PERSONA,
    RESPONSE_CONTRACT,
    ...domainFragments(needs),
    settings.systemContext.trim() && `Additional assistant instructions:\n${settings.systemContext.trim()}`,
    settings.robotContext.trim() && `Robot and mission context:\n${settings.robotContext.trim()}`,
  ];

  if (contextChips.length > 0) {
    const chipLines = contextChips.map(chip => {
      const staleNote = chip.stale ? ' (stale — a reconnect happened since this was fetched; treat with caution)' : '';
      const ageSeconds = Math.round((Date.now() - chip.fetchedAt) / 1000);
      return `### ${chip.label} [source: ${chip.source}, fetched ${ageSeconds}s ago${staleNote}]\n${JSON.stringify(chip.value)}`;
    });
    parts.push(`## Attached context\n${chipLines.join('\n\n')}`);
  }

  return parts.filter(Boolean).join('\n\n');
};
