import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTfTree } from './useTfTree';

const topicMock = vi.hoisted(() => ({
  instances: [] as Array<{
    name: string;
    callback?: (message: unknown) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('roslib', () => ({
  Topic: vi.fn().mockImplementation(function MockTopic(
    this: {
      name: string;
      subscribe: (callback: (message: unknown) => void) => void;
      unsubscribe: ReturnType<typeof vi.fn>;
    },
    options: { name: string }
  ) {
    const instance = {
      name: options.name,
      callback: undefined as ((message: unknown) => void) | undefined,
      unsubscribe: vi.fn(),
    };
    this.name = options.name;
    this.subscribe = callback => {
      instance.callback = callback;
    };
    this.unsubscribe = instance.unsubscribe;
    topicMock.instances.push(instance);
  }),
}));

const message = (parent: string, child: string, sec = 10) => ({
  transforms: [
    {
      header: { frame_id: parent, stamp: { sec, nanosec: 0 } },
      child_frame_id: child,
    },
  ],
});

const stableRos = {} as never;

describe('useTfTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    topicMock.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to both TF topics, batches updates, and cleans up', () => {
    const { result, unmount } = renderHook(() => useTfTree(stableRos));

    expect(topicMock.instances.map(instance => instance.name)).toEqual(['/tf', '/tf_static']);
    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base'));
      topicMock.instances[1].callback?.(message('base', 'camera'));
      vi.advanceTimersByTime(50);
    });

    expect(result.current.state.transformsByChild.get('base')?.source).toBe('dynamic');
    expect(result.current.state.transformsByChild.get('camera')?.source).toBe('static');

    unmount();
    expect(topicMock.instances.every(instance => instance.unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('unsubscribes while inactive and starts from an empty tree when shown again', () => {
    const ros = {} as never;
    const { result, rerender } = renderHook(
      ({ active }) => useTfTree(ros, active),
      { initialProps: { active: true } }
    );

    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base'));
      vi.advanceTimersByTime(50);
    });
    const originalTopics = [...topicMock.instances];

    rerender({ active: false });
    expect(originalTopics.every(instance => instance.unsubscribe.mock.calls.length === 1)).toBe(true);

    rerender({ active: true });
    expect(topicMock.instances.slice(2).map(instance => instance.name)).toEqual(['/tf', '/tf_static']);
    expect(result.current.state.transformsByChild.size).toBe(0);
  });

  it('refresh forgets every frame and rebuilds both subscriptions', () => {
    const ros = {} as never;
    const { result } = renderHook(() => useTfTree(ros));

    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base'));
      topicMock.instances[1].callback?.(message('base', 'old_static'));
      vi.advanceTimersByTime(50);
    });
    const originalTopics = [...topicMock.instances];

    act(() => result.current.refresh());

    expect(originalTopics.every(instance => instance.unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(topicMock.instances.slice(2).map(instance => instance.name)).toEqual(['/tf', '/tf_static']);
    expect(result.current.state.transformsByChild.size).toBe(0);

    // The re-created subscriptions repopulate it: latched statics are re-sent to a new subscriber.
    act(() => {
      topicMock.instances[3].callback?.(message('base', 'new_static'));
      vi.advanceTimersByTime(50);
    });
    expect([...result.current.state.transformsByChild.keys()]).toEqual(['new_static']);
  });

  it('starts over on a new ROS connection', () => {
    const { result, rerender } = renderHook(({ ros }) => useTfTree(ros), { initialProps: { ros: {} as never } });
    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base'));
      vi.advanceTimersByTime(50);
    });
    expect(result.current.state.transformsByChild.has('base')).toBe(true);

    rerender({ ros: {} as never });
    expect(result.current.state.transformsByChild.size).toBe(0);
  });

  it('resets and resubscribes by itself when the publisher clock jumps backwards', () => {
    const { result } = renderHook(() => useTfTree(stableRos));
    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base', 500));
      topicMock.instances[1].callback?.(message('base', 'old_static', 500));
      vi.advanceTimersByTime(50);
    });
    expect(result.current.state.transformsByChild.size).toBe(2);

    // The simulator restarted: stamps start again from zero.
    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base', 1));
      vi.advanceTimersByTime(50);
    });
    expect(topicMock.instances.slice(2).map(instance => instance.name)).toEqual(['/tf', '/tf_static']);
    expect(result.current.state.transformsByChild.has('old_static')).toBe(false);
  });
});
