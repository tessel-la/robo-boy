// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionTools } from './assistantTools';
import { startAssistantMcp } from './assistantMcp';

describe('subscription capability boundaries', () => {
  it('dispatches only code-owned tools and accepts only outstanding replies', async () => {
    const controller = new AbortController(),
      dispatch = vi.fn();
    const tools = new SubscriptionTools(controller.signal, dispatch);
    await expect(tools.execute('Bash', {})).resolves.toMatchObject({ ok: false });
    const pending = tools.execute('read_topic', { name: '/joint_states' });
    const id = dispatch.mock.calls[0][0];
    expect(() => tools.reply('wrong', { ok: true })).toThrow(/expired/);
    expect(() => tools.reply(id, { ok: 'yes' })).toThrow(/Invalid/);
    tools.reply(id, { ok: true, value: { positions: [1, 2] } });
    await expect(pending).resolves.toMatchObject({ ok: true, value: { positions: [1, 2] } });
    expect(() => tools.reply(id, { ok: true })).toThrow(/expired/);
  });
  it('cancels pending callbacks and expires unfinished requests', async () => {
    const controller = new AbortController(),
      tools = new SubscriptionTools(controller.signal, vi.fn());
    const pending = tools.execute('read_tf', {});
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    const another = new SubscriptionTools(new AbortController().signal, vi.fn());
    const unfinished = another.execute('read_tf', {});
    another.dispose();
    await expect(unfinished).rejects.toThrow(/ended/);
  });
  it('preserves native call identity for replay and never duplicates an in-flight mutation', async () => {
    const dispatch = vi.fn(),
      tools = new SubscriptionTools(new AbortController().signal, dispatch);
    const first = tools.execute('edit_workspace', { operations: [] }, 'native-call');
    const replay = tools.execute('edit_workspace', { operations: [] }, 'native-call');
    expect(dispatch).toHaveBeenCalledOnce();
    tools.reply(dispatch.mock.calls[0][0], { ok: true, value: { applied: true } });
    await expect(replay).resolves.toEqual(await first);
    await expect(
      tools.execute('edit_workspace', { operations: [{ op: 'addPanel' }] }, 'native-call')
    ).resolves.toMatchObject({ ok: false });
  });
  it('lets genuine user questions outlive ordinary data reads and cancels them with the request', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController(),
        tools = new SubscriptionTools(controller.signal, vi.fn());
      const pending = tools.execute('ask_user', { question: 'Which controller?' });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(controller.signal.aborted).toBe(false);
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled/);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects oversized or malformed arguments and replies', async () => {
    const dispatch = vi.fn(),
      tools = new SubscriptionTools(new AbortController().signal, dispatch);
    await expect(tools.execute('read_tf', null)).resolves.toMatchObject({ ok: false });
    await expect(tools.execute('read_tf', { huge: 'x'.repeat(270_000) })).resolves.toMatchObject({ ok: false });
    const pending = tools.execute('read_tf', {}),
      id = dispatch.mock.calls[0][0];
    expect(() => tools.reply(id, { ok: true, value: 'x'.repeat(140_000) })).toThrow(/too large/);
    expect(() => tools.reply(id, { ok: true, image: { mimeType: 'text/html', data: 'evil' } })).toThrow(/image/);
    tools.reply(id, { ok: false, error: 'Unavailable' });
    await pending;
  });
  it('serves authenticated MCP tools, never accepts browser origins or missing tokens', async () => {
    const signal = new AbortController(),
      execute = vi.fn(async () => ({ ok: true, value: { measured: 1 } }));
    const bridge = await startAssistantMcp(
      { definitions: [{ name: 'read_tf', description: 'TF', inputSchema: { type: 'object' } }], execute },
      signal.signal
    );
    try {
      expect((await fetch(bridge.url, { method: 'POST', body: '{}' })).status).toBe(403);
      const headers = {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      expect(
        (
          await fetch(bridge.url, {
            method: 'POST',
            headers: { ...headers, Origin: 'https://evil.example' },
            body: '{}',
          })
        ).status
      ).toBe(403);
      expect((await fetch(bridge.url, { headers })).status).toBe(405);
      const response = await fetch(bridge.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'read_tf', arguments: {} },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: { content: [{ type: 'text', text: expect.stringContaining('measured') }] },
      });
      expect(execute).toHaveBeenCalledWith('read_tf', {}, expect.any(String));
    } finally {
      await bridge.close();
    }
    await expect(fetch(bridge.url)).rejects.toThrow();
  });
});
