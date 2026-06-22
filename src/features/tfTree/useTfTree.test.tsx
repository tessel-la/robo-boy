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

const message = (parent: string, child: string) => ({
  transforms: [
    {
      header: { frame_id: parent, stamp: { sec: 10, nanosec: 0 } },
      child_frame_id: child,
    },
  ],
});

describe('useTfTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    topicMock.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes to both TF topics, batches updates, and cleans up', () => {
    const { result, unmount } = renderHook(() => useTfTree({} as never));

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

  it('buffers incoming transforms while paused and publishes them on resume', () => {
    const { result } = renderHook(() => useTfTree({} as never));

    act(() => result.current.pause());
    act(() => {
      topicMock.instances[0].callback?.(message('map', 'base'));
      vi.advanceTimersByTime(200);
    });
    expect(result.current.state.transformsByChild.size).toBe(0);

    act(() => result.current.resume());
    expect(result.current.state.transformsByChild.has('base')).toBe(true);
    expect(result.current.isPaused).toBe(false);
  });
});
