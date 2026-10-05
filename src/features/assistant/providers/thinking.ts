import type { AssistantProviderId } from './types';

export const THINKING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

/** Known model families only. Model default is always available and sends no override. */
export function thinkingEfforts(provider: AssistantProviderId, model: string, subscription = false): ThinkingEffort[] {
  if (provider === 'openai') {
    if (/-pro(?:-|$)|-chat(?:-|$)/.test(model)) return [];
    if (/^gpt-(?:6(?:\.\d+)?|5\.[6-9])(?:-|$)/.test(model)) return ['low', 'medium', 'high', 'xhigh', 'max'];
    if (/^gpt-5\.[2-5](?:-|$)/.test(model)) return ['low', 'medium', 'high', 'xhigh'];
    if (/^gpt-5(?:\.1)?(?:-|$)/.test(model) && !/-chat|-pro/.test(model)) return ['low', 'medium', 'high'];
    if (/^o[134](?:-|$)/.test(model) && !/-pro/.test(model)) return ['low', 'medium', 'high'];
  }
  if (provider === 'anthropic') {
    if (subscription && ['sonnet', 'opus'].includes(model)) return ['low', 'medium', 'high', 'xhigh', 'max'];
    if (/^claude-(?:opus|sonnet)-5(?:-5)?(?:-|$)/.test(model) || /^claude-opus-4-[78](?:-|$)/.test(model))
      return ['low', 'medium', 'high', 'xhigh', 'max'];
    if (/^claude-(?:opus|sonnet)-4-6(?:-|$)/.test(model)) return ['low', 'medium', 'high', 'max'];
  }
  return [];
}

export function selectedThinkingEffort(
  provider: AssistantProviderId,
  model: string,
  effort: ThinkingEffort | undefined,
  subscription = false
): ThinkingEffort | undefined {
  return effort && thinkingEfforts(provider, model, subscription).includes(effort) ? effort : undefined;
}
