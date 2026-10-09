import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { useCameraTopics } from './useCameraTopics';

function fakeRos() {
  const requests: {
    success: (response: { topics: string[]; types: string[] }) => void;
    failure: (error: Error) => void;
  }[] = [];
  const getTopics = vi.fn((success, failure) => requests.push({ success, failure }));
  return { ros: { getTopics } as unknown as Ros, getTopics, requests };
}
const response = (...topics: string[]) => ({ topics, types: topics.map(() => 'sensor_msgs/msg/Image') });

describe('useCameraTopics', () => {
  afterEach(() => vi.useRealTimers());

  it('discovers new topics without remounting and deduplicates competing refreshes', async () => {
    const { ros, requests, getTopics } = fakeRos();
    const { result, unmount } = renderHook(() => useCameraTopics(ros, true));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].success(response()));
    expect(result.current.topics).toEqual([]);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
    });
    expect(first).toBe(second);
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => {
      requests[1].success(response('/camera/late'));
      await first;
    });
    expect(result.current.topics).toEqual(['/camera/late']);
    expect(getTopics).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('preserves the last topic list on refresh failure', async () => {
    const { ros, requests } = fakeRos();
    const { result } = renderHook(() => useCameraTopics(ros, true));
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].success(response('/camera/image_raw')));
    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    await act(async () => requests[1].failure(new Error('Service unavailable')));
    expect(result.current.topics).toEqual(['/camera/image_raw']);
    expect(result.current.error).toMatch(/Could not refresh/);
    expect(result.current.refreshing).toBe(false);
  });

  it('discards callbacks from a previous connection', async () => {
    const old = fakeRos();
    const next = fakeRos();
    const { result, rerender } = renderHook(({ ros }) => useCameraTopics(ros, true), {
      initialProps: { ros: old.ros },
    });
    await waitFor(() => expect(old.requests).toHaveLength(1));
    rerender({ ros: next.ros });
    await waitFor(() => expect(next.requests).toHaveLength(1));
    await act(async () => old.requests[0].success(response('/camera/old')));
    expect(result.current.topics).toEqual([]);
    await act(async () => next.requests[0].success(response('/camera/new')));
    expect(result.current.topics).toEqual(['/camera/new']);
  });

  it('bounds the UI wait without overlapping an unanswered rosapi call', async () => {
    vi.useFakeTimers();
    const { ros, requests } = fakeRos();
    const { result } = renderHook(() => useCameraTopics(ros, true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(result.current.error).toMatch(/timed out/);
    expect(result.current.refreshing).toBe(false);
    act(() => {
      void result.current.refresh();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(requests).toHaveLength(1);
    await act(async () => requests[0].success(response('/camera/stale')));
    expect(result.current.topics).toEqual([]);
    expect(requests).toHaveLength(2);
    await act(async () => requests[1].success(response('/camera/fresh')));
    expect(result.current.topics).toEqual(['/camera/fresh']);
  });

  it('clears discovery on disconnect and does not apply delayed results', async () => {
    const { ros, requests } = fakeRos();
    const { result, rerender } = renderHook(({ connected }) => useCameraTopics(ros, connected), {
      initialProps: { connected: true },
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    rerender({ connected: false });
    await act(async () => requests[0].success(response('/camera/old')));
    expect(result.current.topics).toEqual([]);
    expect(result.current.refreshing).toBe(false);
    expect(await result.current.refresh()).toBe(false);
  });
});
