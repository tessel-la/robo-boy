import { afterEach, describe, expect, it, vi } from 'vitest';
import { panelRosFixture } from '../test/panelRos';
import { PanelRosActions } from './rosActions';

const options = { action: '/robot/move', actionType: 'example_msgs/action/Move', goal: { target: 1 } };
afterEach(() => vi.useRealTimers());

describe('panel ROS 2 action lifetime', () => {
  it.each([4, 5, 6] as const)('resolves only terminal status %s and preserves the existing decoder', async status => {
    const { ros, socket, receive, send } = panelRosFixture();
    const decoder = vi.fn();
    socket.addEventListener('message', decoder);
    const actions = new PanelRosActions(ros);
    const feedback = vi.fn();
    const goal = actions.send(options, feedback);
    const settled = vi.fn();
    void goal.result.then(settled);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'send_action_goal', action: '/robot/move', feedback: true })
    );
    receive({ op: 'action_feedback', id: 'another-goal', values: { progress: 0.9 } });
    receive({ op: 'action_feedback', id: goal.goalId, action: '/other', values: { progress: 0.9 } });
    expect(feedback).not.toHaveBeenCalled();
    receive({ op: 'action_feedback', id: goal.goalId, values: { progress: 0.5 } });
    expect(feedback).toHaveBeenCalledWith({ progress: 0.5 });
    receive({ op: 'action_result', id: goal.goalId, status: 2, result: true, values: {} });
    receive({ op: 'cancel_action_goal', id: goal.goalId, result: true });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    receive({ op: 'action_result', id: goal.goalId, status, result: true, values: { success: status === 4 } });
    await expect(goal.result).resolves.toEqual({ status, result: { success: status === 4 } });
    expect(decoder).toHaveBeenCalledTimes(6);
    actions.dispose();
  });

  it('scopes cancellation to the tile and retries until a terminal result', async () => {
    vi.useFakeTimers();
    const { ros, receive, send } = panelRosFixture();
    const first = new PanelRosActions(ros);
    const second = new PanelRosActions(ros);
    const goal = first.send(options);
    expect(() => second.cancel(goal.goalId)).toThrow('does not own');
    first.cancel(goal.goalId);
    first.cancel(goal.goalId);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(send.mock.calls.filter(([message]) => message.op === 'cancel_action_goal')).toHaveLength(3);
    receive({ op: 'action_result', id: goal.goalId, result: true, status: 5, values: {} });
    await expect(goal.result).resolves.toMatchObject({ status: 5 });
    expect(vi.getTimerCount()).toBe(0);
    first.dispose();
    second.dispose();
  });

  it('continues cancellation after tile disposal and removes listeners at completion', async () => {
    vi.useFakeTimers();
    const { ros, socket, receive, send } = panelRosFixture();
    const remove = vi.spyOn(socket, 'removeEventListener');
    const actions = new PanelRosActions(ros);
    const feedback = vi.fn();
    const goal = actions.send(options, feedback);
    actions.dispose();
    receive({ op: 'action_feedback', id: goal.goalId, values: { progress: 0.5 } });
    expect(feedback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(send.mock.calls.filter(([message]) => message.op === 'cancel_action_goal')).toHaveLength(3);
    receive({ op: 'action_result', id: goal.goalId, status: 5, values: {} });
    await goal.result;
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('close', expect.any(Function));
    expect(() => actions.send(options)).toThrow('disconnected');
  });

  it('rejects connection loss and never replays goals on a replacement socket', async () => {
    vi.useFakeTimers();
    const { ros, close, send } = panelRosFixture();
    const actions = new PanelRosActions(ros);
    const goal = actions.send(options);
    actions.cancel(goal.goalId);
    close();
    await expect(goal.result).rejects.toThrow('completion is unconfirmed');
    expect(vi.getTimerCount()).toBe(0);
    ros.isConnected = true;
    ros.socket = new EventTarget();
    const sent = send.mock.calls.length;
    expect(() => actions.send(options)).toThrow('disconnected');
    expect(send).toHaveBeenCalledTimes(sent);
    actions.dispose();
  });

  it.each([
    {},
    { status: 0 },
    { status: 0, roboboyWorkOutcome: 'unknown' },
    { status: 0, roboboyWorkOutcome: 'not_started' },
    { status: 2, action: options.action, roboboyWorkOutcome: 'not_started' },
  ])('retains cancellation for an uncertain failure (%j) until actual completion', async extra => {
    vi.useFakeTimers();
    const { ros, receive, close, send } = panelRosFixture();
    const actions = new PanelRosActions(ros);
    const goal = actions.send(options);
    receive({ op: 'action_result', id: goal.goalId, result: false, values: 'rosbridge timeout', ...extra });
    await expect(goal.result).rejects.toThrow('rosbridge timeout');
    expect(vi.getTimerCount()).toBe(1);
    expect(() => actions.cancel(goal.goalId)).not.toThrow();
    actions.dispose();
    const cancels = send.mock.calls.filter(([message]) => message.op === 'cancel_action_goal').length;
    vi.advanceTimersByTime(2000);
    expect(send.mock.calls.filter(([message]) => message.op === 'cancel_action_goal')).toHaveLength(cancels + 2);
    receive({ op: 'action_result', id: goal.goalId, status: 6, values: {} });
    expect(vi.getTimerCount()).toBe(0);
    close();
    actions.dispose();
  });

  it.each(['Control lease was revoked', 'Action server rejected the goal'])(
    'releases confirmed never-started goals without cancellation (%s)',
    async reason => {
      vi.useFakeTimers();
      const { ros, receive, send } = panelRosFixture();
      const actions = new PanelRosActions(ros);
      const goal = actions.send(options);
      receive({
        op: 'action_result',
        id: goal.goalId,
        action: options.action,
        status: 0,
        result: false,
        values: reason,
        roboboyWorkOutcome: 'not_started',
      });
      await expect(goal.result).rejects.toThrow(reason);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10000);
      expect(send).toHaveBeenCalledTimes(1);
      actions.dispose();
    }
  );

  it('counts uncertain goals against the shared limit until completion', async () => {
    vi.useFakeTimers();
    const { ros, receive, close } = panelRosFixture();
    const first = new PanelRosActions(ros);
    const second = new PanelRosActions(ros);
    const goals = Array.from({ length: 16 }, () => first.send(options));
    receive({ op: 'action_result', id: goals[0].goalId, status: 0, result: false, values: 'rosbridge timeout' });
    await expect(goals[0].result).rejects.toThrow('rosbridge timeout');
    expect(() => second.send(options)).toThrow('limit');
    receive({ op: 'action_result', id: goals[0].goalId, status: 5, values: {} });
    const replacement = second.send(options);
    close();
    await Promise.all(
      [...goals.slice(1), replacement].map(goal => expect(goal.result).rejects.toThrow('connection lost'))
    );
    first.dispose();
    second.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('limits outstanding goals across tiles on the same ROS connection', async () => {
    const { ros, close } = panelRosFixture();
    const first = new PanelRosActions(ros);
    const second = new PanelRosActions(ros);
    const goals = Array.from({ length: 16 }, () => first.send(options));
    expect(() => second.send(options)).toThrow('limit');
    close();
    await Promise.all(goals.map(goal => expect(goal.result).rejects.toThrow('connection lost')));
    first.dispose();
    second.dispose();
  });

  it('drops oversized feedback and rejects a malformed terminal result', async () => {
    const { ros, receive } = panelRosFixture();
    const actions = new PanelRosActions(ros);
    const feedback = vi.fn();
    const goal = actions.send(options, feedback);
    receive({ op: 'action_feedback', id: goal.goalId, values: { data: 'x'.repeat(1024 * 1024) } });
    expect(feedback).not.toHaveBeenCalled();
    receive({ op: 'action_result', id: goal.goalId, status: 4, values: 'not an object' });
    await expect(goal.result).rejects.toThrow('finite JSON object');
    actions.dispose();
  });
});
