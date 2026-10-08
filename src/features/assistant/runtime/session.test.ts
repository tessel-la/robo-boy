import { describe, expect, it, vi } from 'vitest';
import { AgentLimit, AgentRun, AgentYield, InputQueue } from './session';

describe('agent run ownership', () => {
  it('shares step and tool allowances and yields before another effect', () => {
    const run = new AgentRun(vi.fn(), 2, 2);
    run.beforeStep();
    run.beforeStep();
    expect(() => run.beforeStep()).toThrow(AgentLimit);
    run.beforeTool();
    run.beforeTool();
    expect(() => run.beforeTool()).toThrow(AgentLimit);
    run.steer();
    expect(() => run.beforeTool()).toThrow(AgentYield);
  });
  it('updates one tool event instead of inventing user messages', () => {
    const changed = vi.fn(),
      run = new AgentRun(changed);
    run.emit('tool', 'read_tf', 'running', undefined, 'call');
    run.emit('tool', 'read_tf', 'done', 'Captured', 'call');
    expect(run.events).toHaveLength(1);
    expect(run.events[0]).toMatchObject({ id: 'call', status: 'done' });
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('waits for a real answer and releases pending questions on cancellation', async () => {
    const run = new AgentRun(vi.fn());
    const answer = run.ask('Which operator-approved pose?');
    expect(run.answer('Current measured pose')).toBe(true);
    await expect(answer).resolves.toBe('Current measured pose');
    expect(run.answer('Extra')).toBe(false);
    const cancelled = run.ask('Next question');
    run.cancel();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('runs scoped investigations and returns failures as evidence', async () => {
    const run = new AgentRun(vi.fn());
    const id = await run.spawn('Inspect TF', async task => ({ task, frames: 7 }));
    await expect(run.children.get(id)!.result).resolves.toMatchObject({ ok: true, value: { frames: 7 } });
    const failed = await run.spawn('Inspect logs', async () => {
      throw new Error('No logs');
    });
    await expect(run.children.get(failed)!.result).resolves.toMatchObject({ ok: false, error: 'No logs' });
    await run.spawn('Third', async () => 'done');
    await expect(run.spawn('Fourth', async () => 'unused')).rejects.toThrow(/three/);
    await run.settle();
  });
  it('preserves and edits genuine queued inputs', () => {
    const queue = new InputQueue();
    const queued = queue.enqueue('Later', 'queue');
    const steer = queue.enqueue('Now', 'steer');
    queue.update(queued.id, 'Changed');
    queue.move(queued.id, -1);
    expect(queue.next()).toMatchObject({ text: 'Changed', delivery: 'queue' });
    queue.remove(steer.id);
    expect(queue.next()).toBeUndefined();
    expect(() => queue.enqueue('', 'queue')).toThrow();
  });
});
