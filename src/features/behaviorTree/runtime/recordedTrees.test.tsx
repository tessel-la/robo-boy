import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ros } from 'roslib';
import { PY_TREES_SNAPSHOT_TYPE, pyTreesObservation, useRecordedTreeRuntime } from './recordedTrees';

const fake = vi.hoisted(() => ({ topics: [] as any[] }));
vi.mock('roslib', () => ({
  default: {
    Topic: class {
      name: string;
      listener: any;
      unsubscribe = vi.fn();
      constructor(options: any) {
        this.name = options.name;
        fake.topics.push(this);
      }
      subscribe(listener: any) {
        this.listener = listener;
      }
    },
  },
}));

const uuid = (n: number) => Uint8Array.from({ length: 16 }, (_, i) => (i === 15 ? n : 0));
const none = { uuid: new Uint8Array(16) };
function behaviour(n: number, parent: number | null, children: number[], extra: Record<string, unknown> = {}) {
  return {
    name: `Node ${n}`,
    class_name: 'robot.behaviours.Wait',
    own_id: { uuid: uuid(n) },
    parent_id: parent === null ? none : { uuid: uuid(parent) },
    child_ids: children.map(child => ({ uuid: uuid(child) })),
    status: 1,
    message: '',
    additional_detail: `Main.Node_${n}`,
    blackbox_level: 4,
    ...extra,
  };
}

describe('recorded py_trees snapshots', () => {
  it('become observed trees in tree order, with subtree boundaries and results', () => {
    const snapshot = {
      behaviours: [
        behaviour(2, 1, [3], { blackbox_level: 2, status: 3 }),
        behaviour(1, null, [2, 4], { status: 2, class_name: 'py_trees.composites.Sequence' }),
        behaviour(4, 1, [], { status: 2, message: 'Moving' }),
        behaviour(3, 2, [], { status: 3 }),
      ],
    };
    const tree = pyTreesObservation('/robot/snapshots', snapshot, 5);
    expect(tree).toMatchObject({
      runtime: 'py_trees',
      name: 'Node 1',
      source: '/robot/snapshots',
      state: 'running',
      result: null,
      updatedAt: 5,
    });
    expect(tree.nodes.map(node => node.label)).toEqual(['Node 1', 'Node 2', 'Node 3', 'Node 4']);
    const [root, subtree, inner, moving] = tree.nodes;
    expect(tree.id).toBe(`py_trees:${root.id}`);
    expect(root).toMatchObject({ parentId: null, type: 'Sequence', subtree: false });
    expect(subtree).toMatchObject({
      parentId: root.id,
      subtree: true,
      lastResult: 'success',
      ports: { detail: 'Main.Node_2' },
    });
    expect(inner.parentId).toBe(subtree.id);
    expect(moving).toMatchObject({ status: 'running', nativeStatus: 'RUNNING', feedback: 'Moving' });
    expect(root.id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('accept rosbridge base64 identities and report completion', () => {
    const base64 = (n: number) => btoa(String.fromCharCode(...uuid(n)));
    const tree = pyTreesObservation(
      '/t',
      {
        behaviours: [
          {
            ...behaviour(7, null, []),
            own_id: { uuid: base64(7) },
            parent_id: { uuid: btoa(String.fromCharCode(...new Uint8Array(16))) },
            status: 4,
          },
        ],
      },
      0
    );
    expect(tree).toMatchObject({ state: 'completed', result: 'failure' });
  });

  it.each([
    ['no behaviours', []],
    ['two roots', [behaviour(1, null, []), behaviour(2, null, [])]],
    ['duplicate identity', [behaviour(1, null, [2]), behaviour(2, 1, []), behaviour(2, 1, [])]],
    ['missing child', [behaviour(1, null, [9])]],
    ['wrong parent', [behaviour(1, null, [2]), behaviour(2, 3, [])]],
    ['unreachable node', [behaviour(1, null, []), behaviour(2, 3, [])]],
    ['unknown status', [behaviour(1, null, [], { status: 9 })]],
  ])('reject %s', (_, behaviours) => {
    expect(() => pyTreesObservation('/t', { behaviours }, 0)).toThrow();
  });
});

describe('useRecordedTreeRuntime', () => {
  const ros = {
    getTopics: (callback: (topics: { topics: string[]; types: string[] }) => void) =>
      callback({ topics: ['/robot/snapshots', '/other'], types: [PY_TREES_SNAPSHOT_TYPE, 'std_msgs/msg/String'] }),
  } as unknown as Ros;
  beforeEach(() => {
    vi.useFakeTimers();
    fake.topics.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('follows the latest recorded snapshot of each tree topic, and stops when the replay closes', () => {
    const { result, unmount } = renderHook(() => useRecordedTreeRuntime(ros));
    expect(fake.topics.map(topic => topic.name)).toEqual(['/robot/snapshots']);
    expect(result.current).toMatchObject({ client: null, state: { connected: true, observations: [] } });
    act(() => {
      fake.topics[0].listener({ behaviours: [behaviour(1, null, [], { status: 2 })] });
      fake.topics[0].listener({ behaviours: [behaviour(1, null, [], { status: 3 })] });
      vi.advanceTimersByTime(100);
    });
    expect(result.current.state.observations).toHaveLength(1);
    expect(result.current.state.observations[0]).toMatchObject({ state: 'completed', result: 'success' });
    act(() => {
      fake.topics[0].listener({ behaviours: [] });
      vi.advanceTimersByTime(100);
    });
    expect(result.current.state.error).toMatch('/robot/snapshots');
    expect(result.current.state.observations[0].result).toBe('success'); // The last readable tree stays.
    unmount();
    expect(fake.topics[0].unsubscribe).toHaveBeenCalled();
  });

  it('is idle without a replay source', () => {
    const { result } = renderHook(() => useRecordedTreeRuntime(null));
    expect(fake.topics).toHaveLength(0);
    expect(result.current.state.observations).toEqual([]);
  });
});
