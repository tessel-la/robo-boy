import * as ROSLIB from 'roslib';
import type { Ros } from 'roslib';
import * as THREE from 'three';

import { normalizeFrameId, type TransformStore } from './tfUtils';

export interface TfStreamUpdate {
  transforms: TransformStore;
  changedFrames: ReadonlySet<string>;
}

type TfStreamListener = (update: TfStreamUpdate) => void;
/** Raw `/tf` or `/tf_static` messages, for consumers that need stamps (the TF tree). */
export type TfMessageListener = (message: unknown, source: 'dynamic' | 'static') => void;

type TransformStamped = {
  header?: { frame_id?: unknown };
  child_frame_id?: unknown;
  transform?: {
    translation?: { x?: unknown; y?: unknown; z?: unknown };
    rotation?: { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
  };
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseTransform(candidate: unknown, isStatic: boolean): {
  childFrame: string;
  entry: TransformStore[string];
} | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const stamped = candidate as TransformStamped;
  const rawParent = typeof stamped.header?.frame_id === 'string' ? stamped.header.frame_id.trim() : '';
  const rawChild = typeof stamped.child_frame_id === 'string' ? stamped.child_frame_id.trim() : '';
  const parentFrame = rawParent ? normalizeFrameId(rawParent) : '';
  const childFrame = rawChild ? normalizeFrameId(rawChild) : '';
  const translation = stamped.transform?.translation;
  const rotation = stamped.transform?.rotation;
  const tx = finiteNumber(translation?.x);
  const ty = finiteNumber(translation?.y);
  const tz = finiteNumber(translation?.z);
  const rx = finiteNumber(rotation?.x);
  const ry = finiteNumber(rotation?.y);
  const rz = finiteNumber(rotation?.z);
  const rw = finiteNumber(rotation?.w);

  if (
    !parentFrame ||
    !childFrame ||
    tx === null ||
    ty === null ||
    tz === null ||
    rx === null ||
    ry === null ||
    rz === null ||
    rw === null
  ) {
    return null;
  }

  return {
    childFrame,
    entry: {
      parentFrame,
      transform: {
        translation: new THREE.Vector3(tx, ty, tz),
        rotation: new THREE.Quaternion(rx, ry, rz, rw),
      },
      isStatic,
    },
  };
}

function entriesEqual(left: TransformStore[string] | undefined, right: TransformStore[string]): boolean {
  return Boolean(
    left &&
    left.parentFrame === right.parentFrame &&
    left.isStatic === right.isStatic &&
    left.transform.translation.equals(right.transform.translation) &&
    left.transform.rotation.equals(right.transform.rotation)
  );
}

export function mergeTfMessage(
  current: TransformStore,
  message: unknown,
  isStatic: boolean,
): TfStreamUpdate | null {
  const transforms = (message as { transforms?: unknown } | null | undefined)?.transforms;
  if (!Array.isArray(transforms)) return null;

  let next = current;
  const changedFrames = new Set<string>();

  transforms.forEach(candidate => {
    const parsed = parseTransform(candidate, isStatic);
    if (!parsed || entriesEqual(next[parsed.childFrame], parsed.entry)) return;
    if (next === current) next = { ...current };
    next[parsed.childFrame] = parsed.entry;
    changedFrames.add(parsed.childFrame);
  });

  return changedFrames.size > 0 ? { transforms: next, changedFrames } : null;
}

/**
 * One `/tf` + `/tf_static` subscription per ROS connection, shared by every panel. This is not
 * only about bandwidth: rosbridge re-sends latched (`transient_local`) static transforms in full
 * only to the *first* client of a topic — a client added while another is subscribed receives a
 * single latched message and misses every other static publisher. With one client per
 * connection, `reset()` can drop everything and subscribe again knowing the complete static set
 * comes back.
 */
class SharedTfStream {
  private transforms: TransformStore = {};
  private listeners = new Set<TfStreamListener>();
  private messageListeners = new Set<TfMessageListener>();
  /** Latched static messages seen on this subscription, keyed by the frames they carry, so a
   * message consumer joining later starts from the same static set the store holds. */
  private staticMessages = new Map<string, unknown>();
  private dynamicTopic: ROSLIB.Topic | null = null;
  private staticTopic: ROSLIB.Topic | null = null;
  private running = false;

  constructor(private readonly ros: Ros) {}

  subscribe(listener: TfStreamListener): () => void {
    this.listeners.add(listener);
    listener({
      transforms: this.transforms,
      changedFrames: new Set(Object.keys(this.transforms)),
    });

    if (this.consumerCount() === 1) this.start();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      if (this.consumerCount() === 0) this.stop();
    };
  }

  subscribeToMessages(listener: TfMessageListener): () => void {
    this.messageListeners.add(listener);
    this.staticMessages.forEach(message => listener(message, 'static'));
    if (this.consumerCount() === 1) this.start();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.messageListeners.delete(listener);
      if (this.consumerCount() === 0) this.stop();
    };
  }

  /** Forgets every transform, static ones included, and subscribes again so the robot's current
   * static set is re-sent; dynamic transforms refill as they are published. */
  reset(): void {
    const forgotten = new Set(Object.keys(this.transforms));
    const hadConsumers = this.consumerCount() > 0;
    this.stop();
    this.transforms = {};
    this.staticMessages.clear();
    if (forgotten.size > 0) {
      this.listeners.forEach(listener => {
        try {
          listener({ transforms: this.transforms, changedFrames: forgotten });
        } catch (error) {
          console.error('[SharedTfStream] TF listener failed:', error);
        }
      });
    }
    if (hadConsumers) this.start();
  }

  private consumerCount(): number {
    return this.listeners.size + this.messageListeners.size;
  }

  private start(): void {
    if (this.dynamicTopic || this.staticTopic) return;
    this.running = true;

    this.dynamicTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/tf',
      messageType: 'tf2_msgs/TFMessage',
      throttle_rate: 25,
      queue_length: 1,
      compression: 'cbor',
    });
    this.staticTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/tf_static',
      messageType: 'tf2_msgs/TFMessage',
      throttle_rate: 0,
      queue_length: 1,
      compression: 'cbor',
    });

    this.dynamicTopic.subscribe(this.handleDynamicMessage);
    this.staticTopic.subscribe(this.handleStaticMessage);
  }

  private stop(): void {
    this.running = false;
    this.dynamicTopic?.unsubscribe();
    this.staticTopic?.unsubscribe();
    this.dynamicTopic = null;
    this.staticTopic = null;

    // Static transforms remain valid for the lifetime of this ROS connection and may only have
    // been published once. Dynamic transforms can become stale while no panel is listening.
    this.transforms = Object.fromEntries(
      Object.entries(this.transforms).filter(([, entry]) => entry.isStatic)
    );
  }

  private handleDynamicMessage = (message: unknown): void => {
    if (this.running) this.consume(message, false);
  };

  private handleStaticMessage = (message: unknown): void => {
    if (this.running) this.consume(message, true);
  };

  private consume(message: unknown, isStatic: boolean): void {
    if (isStatic) {
      const transforms = (message as { transforms?: unknown[] } | null)?.transforms;
      if (Array.isArray(transforms)) {
        const key = transforms
          .map(candidate => String((candidate as { child_frame_id?: unknown })?.child_frame_id ?? ''))
          .sort()
          .join('|');
        this.staticMessages.set(key, message);
      }
    }
    this.messageListeners.forEach(listener => {
      try {
        listener(message, isStatic ? 'static' : 'dynamic');
      } catch (error) {
        console.error('[SharedTfStream] TF message listener failed:', error);
      }
    });

    const update = mergeTfMessage(this.transforms, message, isStatic);
    if (!update) return;

    this.transforms = update.transforms;
    this.listeners.forEach(listener => {
      try {
        listener(update);
      } catch (error) {
        console.error('[SharedTfStream] TF listener failed:', error);
      }
    });
  }
}

const streamsByRos = new WeakMap<Ros, SharedTfStream>();

const streamFor = (ros: Ros): SharedTfStream => {
  let stream = streamsByRos.get(ros);
  if (!stream) {
    stream = new SharedTfStream(ros);
    streamsByRos.set(ros, stream);
  }
  return stream;
};

export function subscribeToTfStream(ros: Ros, listener: TfStreamListener): () => void {
  return streamFor(ros).subscribe(listener);
}

export function subscribeToTfMessages(ros: Ros, listener: TfMessageListener): () => void {
  return streamFor(ros).subscribeToMessages(listener);
}

/** Drops every transform known on this connection and subscribes again — see `SharedTfStream`. */
export function resetTfStream(ros: Ros): void {
  streamsByRos.get(ros)?.reset();
}
