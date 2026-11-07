import { HOST_TOOL_DEFINITIONS } from '../tools/nativeTools';

/** Declarative operator policies only: no scripts, shell, permissions or automatic motion. */
export interface AgentHook {
  id: string;
  enabled: boolean;
  tool: string;
  when: 'before' | 'success' | 'error';
  action: 'block' | 'note';
  message: string;
}
const KEY = 'robo-boy-agent-hooks-v1';
const valid = (hook: AgentHook): boolean =>
  Boolean(
    hook &&
    typeof hook.id === 'string' &&
    hook.id.length <= 128 &&
    typeof hook.enabled === 'boolean' &&
    HOST_TOOL_DEFINITIONS.some(tool => tool.name === hook.tool) &&
    ['before', 'success', 'error'].includes(hook.when) &&
    ['block', 'note'].includes(hook.action) &&
    (hook.action !== 'block' || hook.when === 'before') &&
    typeof hook.message === 'string' &&
    hook.message.length > 0 &&
    hook.message.length <= 1000
  );
export function loadAgentHooks(): AgentHook[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  // Invalid policies fail closed: do not silently drop a user-configured block.
  if (raw.length > 16_000) throw new Error('Agent hook policies exceed their storage allowance.');
  const hooks = JSON.parse(raw);
  if (!Array.isArray(hooks) || hooks.length > 12 || !hooks.every(valid))
    throw new Error('Invalid agent hook policies. Fix them in settings before running the agent.');
  return hooks;
}
export function storeAgentHooks(hooks: AgentHook[]): void {
  if (hooks.length > 12 || !hooks.every(valid))
    throw new Error('Use at most twelve bounded policies for known host tools.');
  const raw = JSON.stringify(hooks);
  if (raw.length > 16_000) throw new Error('Hook policies exceed 16 KiB.');
  localStorage.setItem(KEY, raw);
}
