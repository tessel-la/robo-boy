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
    await Promise.resolve();
    const id = dispatch.mock.calls[0][0];
    expect(() => tools.reply('wrong', { ok: true })).toThrow(/expired/);
    tools.reply(id, { ok: true, value: { positions: [1, 2] } });
    await expect(pending).resolves.toMatchObject({ ok: true, value: { positions: [1, 2] } });
    expect(() => tools.reply(id, { ok: true })).toThrow(/expired/);
  });
  it('cancels pending callbacks and expires unfinished requests', async () => {
    const controller = new AbortController(),
      tools = new SubscriptionTools(controller.signal, vi.fn());
    const pending = tools.execute('read_tf', {});
    await Promise.resolve();
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
    await Promise.resolve();
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
    for (const [value, error] of [
      [{ ok: 'yes' }, /Invalid/],
      [{ ok: true, value: 'x'.repeat(140_000) }, /too large/],
      [{ ok: true, image: { mimeType: 'text/html', data: 'evil' } }, /image/],
    ] as const) {
      const pending = tools.execute('read_tf', {});
      const rejected = expect(pending).rejects.toThrow(error);
      await Promise.resolve();
      await Promise.resolve();
      const id = dispatch.mock.calls.at(-1)![0];
      expect(() => tools.reply(id, value)).toThrow(error);
      await rejected;
      expect(() => tools.reply(id, { ok: true })).toThrow(/expired/);
    }
  });
  it('fails an oversized escaped checkpoint immediately instead of timing out __step', async () => {
    const dispatch = vi.fn();
    const tools = new SubscriptionTools(new AbortController().signal, dispatch);
    const result = tools.checkpoint();
    const rejected = expect(result).rejects.toThrow(/too large/);
    await Promise.resolve();
    // Raw text fits the checkpoint limit; its serialized envelope does not.
    const systemPrompt = '"'.repeat(80_000);
    expect(() => tools.reply(dispatch.mock.calls[0][0], { ok: true, value: { systemPrompt } })).toThrow(/too large/);
    await rejected;
  });
  it('settles a failed steering checkpoint without waiting for a deadline', async () => {
    const dispatch = vi.fn();
    const tools = new SubscriptionTools(new AbortController().signal, dispatch);
    const result = tools.checkpoint();
    const rejected = expect(result).rejects.toThrow(/Steering requested/);
    await Promise.resolve();
    tools.reply(dispatch.mock.calls[0][0], {
      ok: false,
      error: 'Steering requested. Completed changes are preserved.',
    });
    await rejected;
  });
  it('starts deadlines at dispatch rather than while a parallel call waits in the queue', async () => {
    vi.useFakeTimers();
    try {
      const dispatch = vi.fn();
      const controller = new AbortController();
      const tools = new SubscriptionTools(controller.signal, dispatch, undefined, undefined, reason =>
        controller.abort(reason)
      );
      const first = tools.execute('read_tf', {});
      const second = tools.execute('read_topic', { name: '/joint_states' });
      await vi.advanceTimersByTimeAsync(29_000);
      expect(dispatch).toHaveBeenCalledOnce();
      tools.reply(dispatch.mock.calls[0][0], { ok: true });
      await first;
      await vi.advanceTimersByTimeAsync(2000);
      expect(controller.signal.aborted).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(2);
      tools.reply(dispatch.mock.calls[1][0], { ok: true });
      await second;
    } finally {
      vi.useRealTimers();
    }
  });
  it('preserves the timed-out tool name as the cancellation reason', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const tools = new SubscriptionTools(controller.signal, vi.fn(), undefined, undefined, reason =>
        controller.abort(reason)
      );
      const result = tools.execute('read_tf', {});
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(result).resolves.toMatchObject({ ok: false });
      expect(controller.signal.reason).toMatchObject({
        name: 'TimeoutError',
        message: expect.stringContaining('read_tf timed out'),
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it('never dispatches queued mutations after disposal', async () => {
    const dispatch = vi.fn();
    const tools = new SubscriptionTools(new AbortController().signal, dispatch);
    const first = tools.execute('read_tf', {});
    const next = tools.execute('edit_workspace', { operations: [{ op: 'addPanel', type: 'pad' }] });
    const firstCheck = expect(first).rejects.toThrow(/ended/);
    const nextCheck = expect(next).rejects.toThrow(/ended/);
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    tools.dispose();
    await Promise.all([firstCheck, nextCheck]);
    expect(dispatch).toHaveBeenCalledOnce();
    await expect(tools.execute('read_tf', {})).rejects.toThrow(/ended/);
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
