import { useEffect, useState } from 'react';
import ROSLIB, { Ros, Topic } from 'roslib';
import { MAX_OBSERVED_NODES } from './RemoteTreeRuntime';
import type { RuntimeNode, RuntimeObservation, RuntimeState } from './types';

/**
 * Behavior trees in a recording. The host's `/robo_boy/bt/events` stream is incremental, so a replay cursor
 * cannot be rebuilt from it; py_trees_ros snapshots are complete trees, so the last one at any cursor is the
 * tree's whole state there, after seeking backwards or looping too. BT.CPP telemetry (Groot2 over ZMQ) is
 * not ROS traffic and is never in a recording.
 */
export const PY_TREES_SNAPSHOT_TYPE = 'py_trees_ros_interfaces/msg/BehaviourTree';
/** Snapshots can be megabytes; convert the latest one per topic at most this often. */
const CONVERT_INTERVAL_MS = 100;

type UuidValue = Uint8Array | number[] | string | null | undefined;
interface RecordedBehaviour {
  name: string;
  class_name: string;
  own_id: { uuid: UuidValue };
  parent_id: { uuid: UuidValue };
  child_ids: { uuid: UuidValue }[];
  status: number;
  message: string;
  additional_detail: string;
  blackbox_level: number;
}

const STATUSES: Record<number, [RuntimeNode['status'], string]> = {
  1: ['idle', 'INVALID'],
  2: ['running', 'RUNNING'],
  3: ['success', 'SUCCESS'],
  4: ['failure', 'FAILURE'],
};
// DETAIL, COMPONENT and BIG_PICTURE mark a collapsible boundary; NOT_A_BLACKBOX (4) does not.
const BLACKBOX_LEVELS = new Set([1, 2, 3]);

/** `uint8[16]` as a recording (typed array) or rosbridge (base64) delivers it; null for the zero UUID. */
function uuidOf(value: UuidValue): string | null {
  const bytes =
    typeof value === 'string' ? Uint8Array.from(atob(value), char => char.charCodeAt(0)) : Uint8Array.from(value ?? []);
  if (bytes.length !== 16) throw new Error('Invalid py_trees snapshot identity');
  if (bytes.every(byte => byte === 0)) return null;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One py_trees_ros snapshot as an observed tree, with the host monitor's conventions. */
export function pyTreesObservation(
  source: string,
  message: { behaviours?: RecordedBehaviour[] },
  updatedAt: number
): RuntimeObservation {
  const behaviours = message.behaviours ?? [];
  if (!behaviours.length || behaviours.length > MAX_OBSERVED_NODES) throw new Error('Invalid py_trees snapshot size');
  const byId = new Map<string, RecordedBehaviour>();
  for (const behaviour of behaviours) {
    const id = uuidOf(behaviour.own_id?.uuid);
    if (!id || byId.has(id)) throw new Error('Invalid py_trees snapshot identities');
    byId.set(id, behaviour);
  }
  const roots = [...byId].filter(([, behaviour]) => uuidOf(behaviour.parent_id?.uuid) === null);
  if (roots.length !== 1) throw new Error('py_trees snapshot needs one root');
  const nodes: RuntimeNode[] = [];
  const stack: [string, string | null, number][] = [[roots[0][0], null, 0]];
  while (stack.length) {
    const [id, parentId, depth] = stack.pop()!;
    const behaviour = byId.get(id);
    if (!behaviour || depth > 64 || uuidOf(behaviour.parent_id?.uuid) !== parentId)
      throw new Error('Invalid py_trees snapshot topology');
    const status = STATUSES[behaviour.status];
    if (!status) throw new Error('Invalid py_trees snapshot status');
    const children = (behaviour.child_ids ?? []).map(child => uuidOf(child.uuid));
    if (children.some(child => child === null)) throw new Error('Invalid py_trees snapshot child');
    nodes.push({
      id,
      parentId,
      label: behaviour.name,
      type: behaviour.class_name.split('.').pop() || behaviour.class_name,
      status: status[0],
      nativeStatus: status[1],
      feedback: (behaviour.message ?? '').slice(0, 4096),
      ports: { class: behaviour.class_name, detail: behaviour.additional_detail ?? '' },
      subtree: children.length > 0 && BLACKBOX_LEVELS.has(behaviour.blackbox_level),
      ...(status[0] === 'success' || status[0] === 'failure'
        ? { lastResult: status[0], lastNativeResult: status[1] }
        : {}),
    });
    for (let index = children.length - 1; index >= 0; index--) stack.push([children[index]!, id, depth + 1]);
  }
  if (nodes.length !== byId.size) throw new Error('Unreachable py_trees snapshot nodes');
  const root = nodes[0];
  const result = root.status === 'success' || root.status === 'failure' ? root.status : null;
  return {
    id: `py_trees:${root.id}`,
    runtime: 'py_trees',
    name: root.label,
    source,
    nodes,
    state: result ? 'completed' : root.status === 'running' ? 'running' : 'loaded',
    result,
    error: null,
    connected: true,
    updatedAt,
  };
}

const replayState = (observations: RuntimeObservation[], error: string | null = null): RuntimeState => ({
  connected: true,
  runtimes: [],
  session: null,
  logs: [],
  error,
  observations,
});

/** Read-only runtime state of the trees in a replayed recording (`ros` is the replay source). */
export function useRecordedTreeRuntime(ros: Ros | null) {
  const [state, setState] = useState<RuntimeState>(() => replayState([]));
  useEffect(() => {
    if (!ros) return;
    setState(replayState([]));
    const topics: Topic[] = [];
    const pending = new Map<string, unknown>();
    const observations = new Map<string, RuntimeObservation>();
    let error: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const convert = () => {
      timer = undefined;
      pending.forEach((message, topic) => {
        try {
          observations.set(
            topic,
            pyTreesObservation(topic, message as { behaviours?: RecordedBehaviour[] }, Date.now())
          );
          error = null;
        } catch (cause) {
          error = `Recorded tree on ${topic} is unreadable: ${(cause as Error).message}`;
        }
      });
      pending.clear();
      setState(replayState([...observations.values()].slice(-16), error));
    };
    ros.getTopics(
      ({ topics: names, types }) =>
        names.forEach((name, index) => {
          if (types[index] !== PY_TREES_SNAPSHOT_TYPE) return;
          const topic = new ROSLIB.Topic({ ros, name, messageType: PY_TREES_SNAPSHOT_TYPE });
          topic.subscribe(message => {
            pending.set(name, message);
            timer ??= setTimeout(convert, CONVERT_INTERVAL_MS);
          });
          topics.push(topic);
        }),
      () => setState(replayState([], 'The recording does not list its topics.'))
    );
    return () => {
      if (timer) clearTimeout(timer);
      topics.forEach(topic => topic.unsubscribe());
    };
  }, [ros]);
  return { client: null, state };
}
