// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeEnvironment, claudeResult, CLAUDE_CHAT_FLAGS } from './claudeSubscription';

describe('Claude runtime isolation', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('removes credentials, gateways and customization environment while keeping native browser access', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'secret');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'secret');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'secret');
    vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '1');
    vi.stubEnv('NODE_OPTIONS', '--require malicious.js');
    vi.stubEnv('BROWSER', 'malicious-browser');
    vi.stubEnv('DISPLAY', ':1');
    const env = claudeEnvironment('/private/roboboy/claude');
    expect(env).toMatchObject({
      CLAUDE_CONFIG_DIR: '/private/roboboy/claude',
      CLAUDE_CODE_SAFE_MODE: '1',
      DISPLAY: ':1',
    });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(env).not.toHaveProperty('CLAUDE_CODE_USE_BEDROCK');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('BROWSER');
  });
  it('removes all runtime tools and customizations without bypassing permissions', () => {
    expect(CLAUDE_CHAT_FLAGS[CLAUDE_CHAT_FLAGS.indexOf('--tools') + 1]).toBe('');
    expect(CLAUDE_CHAT_FLAGS).toContain('--restricted');
    expect(CLAUDE_CHAT_FLAGS).toContain('--safe-mode');
    expect(CLAUDE_CHAT_FLAGS).toContain('--strict-mcp-config');
    expect(CLAUDE_CHAT_FLAGS).toContain('mcp__*');
    expect(CLAUDE_CHAT_FLAGS).toContain('--no-session-persistence');
    expect(CLAUDE_CHAT_FLAGS).toContain('dontAsk');
    expect(CLAUDE_CHAT_FLAGS.join(' ')).not.toMatch(/skip-permissions|bypassPermissions/);
  });
  it('accepts only a completed successful result', () => {
    expect(
      claudeResult('{"type":"system"}\n{"type":"result","subtype":"success","is_error":false,"result":"ok"}\n')
    ).toBe('ok');
    expect(() => claudeResult('{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}')).toThrow(
      /did not complete/
    );
    expect(() => claudeResult('{"type":"result","subtype":"error_max_turns","is_error":true}')).toThrow(
      /did not complete/
    );
    expect(() =>
      claudeResult('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}')
    ).toThrow(/tool call/);
  });
});
