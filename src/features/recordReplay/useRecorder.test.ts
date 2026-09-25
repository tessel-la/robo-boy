import { act, renderHook } from '@testing-library/react';
import type { Ros } from 'roslib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRecordOptions } from './types';
import { useRecorder } from './useRecorder';

const mocks = vi.hoisted(() => ({
  topics: [] as Array<{ name: string; listener?: (message: { data: string }) => void; published: Array<{ data: string }>; unsubscribe: () => void; unadvertise: () => void }>,
}));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      name: string;
      listener?: (message: { data: string }) => void;
      published: Array<{ data: string }> = [];
      unsubscribe = vi.fn();
      unadvertise = vi.fn();
      constructor(options: { name: string }) {
        this.name = options.name;
        mocks.topics.push(this);
      }
      subscribe(listener: (message: { data: string }) => void) { this.listener = listener; }
      publish(message: { data: string }) { this.published.push(message); }
    },
    Message: class { constructor(values: object) { Object.assign(this, values); } },
  },
}));

const ros = {} as Ros;
const getRandomValues = crypto.getRandomValues.bind(crypto);
const topic = (name: string) => mocks.topics.filter(candidate => candidate.name === name).pop()!;
const status = (value: Record<string, unknown>) => act(() => {
  topic('/roboboy/recorder/status').listener?.({ data: JSON.stringify({ version: 1, state: 'idle', root: '/recordings', path: '', messages: 0, bytes: 0, dropped: 0, elapsed: 0, topics: [], ...value }) });
});
const lastCommand = () => {
  const { published } = topic('/roboboy/recorder/command');
  return JSON.parse(published[published.length - 1].data);
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.topics.length = 0;
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `id-${mocks.topics.length}-${Math.random()}`) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useRecorder', () => {
  it('starts a recording over HTTP where randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues });
    const { result } = renderHook(() => useRecorder(ros, true));
    status({});
    act(() => result.current.command('start', defaultRecordOptions()));
    const sent = lastCommand();
    expect(sent.action).toBe('start');
    expect(sent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    status({ state: 'recording', requestId: sent.id, messages: 1 });
    expect(result.current).toMatchObject({ pending: false, error: '', status: { state: 'recording', messages: 1 } });
  });

  it('stays offline without a connection', () => {
    const { result } = renderHook(() => useRecorder(null, false));
    expect(result.current.online).toBe(false);
    expect(mocks.topics).toEqual([]);
    act(() => result.current.command('status'));
    expect(result.current.pending).toBe(false);
  });

  it('goes online on recorder status and ignores unrelated messages', () => {
    const { result } = renderHook(() => useRecorder(ros, true));
    act(() => topic('/roboboy/recorder/status').listener?.({ data: 'not json' }));
    act(() => topic('/roboboy/recorder/status').listener?.({ data: JSON.stringify({ version: 2, state: 'idle' }) }));
    expect(result.current.online).toBe(false);
    status({ state: 'recording', messages: 5 });
    expect(result.current.online).toBe(true);
    expect(result.current.status).toMatchObject({ state: 'recording', messages: 5 });

    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current.online).toBe(false);
  });

  it('sends one command at a time and settles it on the matching acknowledgement', () => {
    const { result } = renderHook(() => useRecorder(ros, true));
    status({});
    const options = defaultRecordOptions();
    act(() => result.current.command('start', options));
    const sent = lastCommand();
    expect(sent).toMatchObject({ version: 1, action: 'start', options });
    expect(result.current.pending).toBe(true);

    act(() => result.current.command('stop'));
    expect(topic('/roboboy/recorder/command').published).toHaveLength(1);

    status({ requestId: 'someone-else' });
    expect(result.current.pending).toBe(true);
    status({ requestId: sent.id, requestError: 'That recording already exists. Choose a new name.' });
    expect(result.current).toMatchObject({ pending: false, error: 'That recording already exists. Choose a new name.' });
  });

  it('lists folders and existing recordings separately', () => {
    const { result } = renderHook(() => useRecorder(ros, true));
    status({});
    act(() => result.current.command('folders', undefined, 'robots'));
    expect(lastCommand()).toMatchObject({ action: 'folders', path: 'robots' });
    status({ requestId: lastCommand().id, directory: 'robots', folders: ['day1'], recordings: ['run_a'] });
    expect(result.current.folders).toEqual({ directory: 'robots', folders: ['day1'], recordings: ['run_a'] });

    act(() => result.current.command('folders', undefined, ''));
    status({ requestId: lastCommand().id, directory: '.', folders: [] });
    expect(result.current.folders).toEqual({ directory: '.', folders: [], recordings: [] });
  });

  it('gives up on a command nobody acknowledges', () => {
    const { result } = renderHook(() => useRecorder(ros, true));
    status({});
    act(() => result.current.command('pause'));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(result.current).toMatchObject({ pending: false, error: 'No acknowledgement from the recorder. Check its status before retrying.' });
  });

  it('releases both topics on unmount', () => {
    const { unmount } = renderHook(() => useRecorder(ros, true));
    const input = topic('/roboboy/recorder/status');
    const output = topic('/roboboy/recorder/command');
    unmount();
    expect(input.unsubscribe).toHaveBeenCalled();
    expect(output.unadvertise).toHaveBeenCalled();
  });
});
