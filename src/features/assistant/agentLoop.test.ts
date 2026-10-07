import { describe, expect, it, vi } from 'vitest';
import { runAssistantTurn } from './agentLoop';
import { parseAssistantResponse } from './responseParser';

const parse = (raw: string) => parseAssistantResponse(raw, { actions: {}, services: {} });
const explain = JSON.stringify({ kind: 'explanation', message: 'Completed.' });
const read = JSON.stringify({ kind: 'contextRequest', reads: [{ kind: 'topic', name: '/joint_states' }] });

describe('assistant turn loop', () => {
  it('observes read results before answering within the same turn', async () => {
    const request = vi.fn().mockResolvedValueOnce(read).mockResolvedValueOnce(explain);
    const execute = vi.fn(async response => response.kind === 'contextRequest' ? { joint_names: ['joint1'], positions: [0.5] } : undefined);
    const result = await runAssistantTurn({ signal: new AbortController().signal, checkCurrent: () => {}, request, parse, execute, validate: () => [] });
    expect(result).toMatchObject({ kind: 'explanation' });
    expect(request.mock.calls[1][0][0].result).toEqual({ joint_names: ['joint1'], positions: [0.5] });
  });
  it('repairs an invalid empty action goal before executing or exposing a proposal', async () => {
    const bad = JSON.stringify({ kind: 'padProposal', layout: { name: 'Pad', components: [{ type: 'button', eventOperations: { press: { kind: 'action', name: '/home', messageType: 'control_msgs/action/FollowJointTrajectory', payload: {} } } }] } });
    const request = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(read).mockResolvedValueOnce(explain);
    const execute = vi.fn(async response => response.kind === 'contextRequest' ? { sample: 1 } : undefined);
    await runAssistantTurn({ signal: new AbortController().signal, checkCurrent: () => {}, request, parse, execute, validate: () => [] });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0][0].result.error).toContain('empty goal');
  });
  it('cancels after a read without calling the model again', async () => {
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(read);
    await expect(runAssistantTurn({ signal: controller.signal, checkCurrent: () => {}, request, parse,
      execute: async () => { controller.abort(); return { value: 'late' }; }, validate: () => [] })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('discards work when the connection changes during a model response', async () => {
    let current = true;
    const execute = vi.fn();
    await expect(runAssistantTurn({ signal: new AbortController().signal,
      checkCurrent: () => { if (!current) throw new Error('Connection changed'); },
      request: async () => { current = false; return explain; }, parse, execute, validate: () => [] })).rejects.toThrow('Connection changed');
    expect(execute).not.toHaveBeenCalled();
  });
  it('bounds repeated tool use', async () => {
    const request = vi.fn().mockResolvedValue(read);
    await expect(runAssistantTurn({ signal: new AbortController().signal, checkCurrent: () => {}, request, parse, execute: async () => ({ ok: true }), validate: () => [] })).rejects.toThrow('12-round limit');
    expect(request).toHaveBeenCalledTimes(12);
  });
});
