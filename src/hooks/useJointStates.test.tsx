import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { useJointStates } from './useJointStates';
const topics = vi.hoisted(
  () => [] as { name: string; receive: (message: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> }[]
);
vi.mock('roslib', () => ({
  Topic: vi.fn(function (options) {
    const topic = {
      ...options,
      receive: (_message: unknown) => {},
      subscribe(cb: (message: unknown) => void) {
        this.receive = cb;
      },
      unsubscribe: vi.fn(),
    };
    topics.push(topic);
    return topic;
  }),
}));
vi.mock('../features/recordReplay/ReplaySession', () => ({
  isReplayRos: (ros: { replay?: boolean }) => ros.replay === true,
}));
beforeEach(() => {
  topics.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
it('merges partial joint publishers by name, clears obsolete limits and releases source-owned observers', () => {
  const ros = {} as Ros;
  const { result, rerender, unmount } = renderHook(
    ({ source, name }) => useJointStates(source, name, 'sensor_msgs/JointState', '/robot_description'),
    { initialProps: { source: ros, name: '/joints' } }
  );
  act(() => {
    topics[0].receive({ name: ['a'], position: [1] });
    topics[0].receive({ name: ['b'], velocity: [2] });
    topics[1].receive({
      data: '<robot><joint name="a" type="revolute"><limit lower="-2" upper="2" /></joint></robot>',
    });
  });
  expect(result.current.joints.map(joint => joint.name)).toEqual(['a', 'b']);
  expect(result.current.limits.a.upper).toBe(2);
  act(() => topics[1].receive({ data: 'invalid' }));
  expect(result.current.limits).toEqual({});
  expect(result.current.descriptionError).toBeTruthy();
  act(() => topics[0].receive({ name: ['a'], position: [1, 2] }));
  expect(result.current.messageError).toContain('match');
  const old = [...topics];
  rerender({ source: { replay: true } as unknown as Ros, name: '/recorded' });
  expect(result.current.joints).toEqual([]);
  old.forEach(topic => expect(topic.unsubscribe).toHaveBeenCalledOnce());
  act(() => old[0].receive({ name: ['old'], position: [9] }));
  expect(result.current.joints).toEqual([]);
  act(() => topics[2].receive({ name: ['recorded'], position: [3] }));
  const now = result.current.now;
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current.replay).toBe(true);
  expect(result.current.now).toBe(now);
  unmount();
  topics.forEach(topic => expect(topic.unsubscribe).toHaveBeenCalledOnce());
});
