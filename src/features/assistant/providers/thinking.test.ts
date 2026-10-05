import { describe, expect, it } from 'vitest';
import { selectedThinkingEffort, thinkingEfforts } from './thinking';

describe('model thinking controls', () => {
  it('uses only recognized reasoning models and does not carry stale or runtime-tool modes forward', () => {
    expect(thinkingEfforts('openai', 'gpt-6.1-sol')).toContain('max');
    expect(thinkingEfforts('openai', 'gpt-4.1')).toEqual([]);
    expect(thinkingEfforts('openai', 'gpt-5-pro')).toEqual([]);
    expect(thinkingEfforts('anthropic', 'haiku', true)).toEqual([]);
    expect(thinkingEfforts('anthropic', 'sonnet', true)).toContain('high');
    expect(thinkingEfforts('anthropic', 'claude-opus-4-6')).not.toContain('xhigh');
    expect(selectedThinkingEffort('openai', 'gpt-4.1', 'high')).toBeUndefined();
    expect(selectedThinkingEffort('anthropic', 'sonnet', 'ultracode' as any, true)).toBeUndefined();
  });
});
