import * as THREE from 'three';
import { invertTransform, multiplyTransforms, type StoredTransform } from './tfUtils';

import { TF_HISTORY_NS, TF_SAMPLES_PER_FRAME, TF_MAX_FRAMES } from './tfHistoryLimits';
export { TF_SAMPLES_PER_FRAME } from './tfHistoryLimits';

/** Missing/zero stamps use ROS's latest-transform convention. Malformed stamps never do. */
export function rosStamp(stamp: unknown): bigint | null {
  if (stamp === undefined) return 0n;
  if (!stamp || typeof stamp !== 'object') return null;
  const value = stamp as Record<string, unknown>;
  const sec = value.sec ?? value.secs;
  const nsec = value.nanosec ?? value.nsecs;
  if (
    !Number.isSafeInteger(sec) ||
    !Number.isSafeInteger(nsec) ||
    (sec as number) < 0 ||
    (nsec as number) < 0 ||
    (nsec as number) >= 1e9
  )
    return null;
  return BigInt(sec as number) * 1_000_000_000n + BigInt(nsec as number);
}

type Sample = StoredTransform & { parent: string; time: bigint };
type Frame = { static: boolean; samples: Sample[] };
export type TransformResult = { transform: StoredTransform; error: null } | { transform: null; error: string };
const identity = (): StoredTransform => ({ translation: new THREE.Vector3(), rotation: new THREE.Quaternion() });
const frameName = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '');

/** Connection-owned sensor-time history. No wall clock: this also works with /clock and bags. */
export class TfHistory {
  private frames = new Map<string, Frame>();
  private listeners = new Set<() => void>();
  source = '/tf';

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('[TfHistory] Transform listener failed:', error);
      }
    });
  }

  clear(dynamicOnly = false) {
    if (dynamicOnly) {
      for (const [child, frame] of this.frames) if (!frame.static) this.frames.delete(child);
    } else this.frames.clear();
    this.notify();
  }

  ingest(message: unknown, isStatic: boolean) {
    const transforms = (message as { transforms?: unknown[] } | null)?.transforms;
    if (!Array.isArray(transforms)) return;
    let changed = false;
    for (const raw of transforms) {
      const value = raw as any;
      const child = frameName(value?.child_frame_id),
        parent = frameName(value?.header?.frame_id);
      const time = rosStamp(value?.header?.stamp);
      const p = value?.transform?.translation,
        q = value?.transform?.rotation;
      if (
        !child ||
        !parent ||
        child === parent ||
        time === null ||
        (!isStatic && time === 0n) ||
        ![p?.x, p?.y, p?.z, q?.x, q?.y, q?.z, q?.w].every(Number.isFinite)
      )
        continue;
      const rotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
      if (!Number.isFinite(rotation.lengthSq()) || rotation.lengthSq() < 1e-12) continue;
      const sample: Sample = {
        parent,
        time,
        translation: new THREE.Vector3(p.x, p.y, p.z),
        rotation: rotation.normalize(),
      };
      let frame = this.frames.get(child);
      if (!frame || frame.static !== isStatic) {
        if (!frame && this.frames.size >= TF_MAX_FRAMES) continue;
        frame = { static: isStatic, samples: [] };
        this.frames.set(child, frame);
      }
      const samples = frame.samples;
      if (isStatic) samples.splice(0, samples.length, sample);
      else {
        const latest = samples[samples.length - 1]?.time ?? time;
        if (time < latest - TF_HISTORY_NS) continue;
        let index = samples.length;
        while (index > 0 && samples[index - 1].time >= time) index--;
        if (samples[index]?.time === time) samples[index] = sample;
        else samples.splice(index, 0, sample);
        const cutoff = samples[samples.length - 1].time - TF_HISTORY_NS;
        while (samples.length > TF_SAMPLES_PER_FRAME || samples[0].time < cutoff) samples.shift();
      }
      changed = true;
    }
    if (changed) this.notify();
  }

  private sample(child: string, time: bigint): Sample | string | undefined {
    const frame = this.frames.get(child);
    if (!frame) return undefined;
    const samples = frame.samples;
    if (frame.static) return samples[0];
    const first = samples[0],
      last = samples[samples.length - 1];
    if (time < first.time) return `TF history too old for ${child} (${this.source}; bounded sampled history).`;
    if (time > last.time) return `Waiting for TF at message time for ${child} (${this.source}).`;
    let low = 0,
      high = samples.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (samples[mid].time < time) low = mid + 1;
      else high = mid;
    }
    const next = samples[low];
    if (next.time === time) return next;
    const previous = samples[low - 1];
    if (previous.parent !== next.parent) return `TF parent changed around message time for ${child}.`;
    const alpha = Number(time - previous.time) / Number(next.time - previous.time);
    return {
      parent: next.parent,
      time,
      translation: previous.translation.clone().lerp(next.translation, alpha),
      rotation: previous.rotation.clone().slerp(next.rotation, alpha),
    };
  }

  lookup(target: string, source: string, time: bigint): TransformResult {
    target = frameName(target);
    source = frameName(source);
    if (!target || !source) return { transform: null, error: 'Message or fixed frame is missing.' };
    // Common-ancestor traversal avoids querying irrelevant ancestors above the requested target.
    const sourceChain = new Map<string, StoredTransform>();
    let frame = source,
      pose = identity(),
      sourceError = '';
    while (!sourceChain.has(frame)) {
      sourceChain.set(frame, pose);
      if (frame === target) return { transform: pose, error: null };
      const edge = this.sample(frame, time);
      if (!edge || typeof edge === 'string') {
        sourceError = edge ?? '';
        break;
      }
      pose = multiplyTransforms(edge, pose);
      frame = edge.parent;
    }
    const visited = new Set<string>();
    frame = target;
    pose = identity();
    while (!visited.has(frame)) {
      const common = sourceChain.get(frame);
      if (common) return { transform: multiplyTransforms(invertTransform(pose), common), error: null };
      visited.add(frame);
      const edge = this.sample(frame, time);
      if (typeof edge === 'string') return { transform: null, error: sourceError || edge };
      if (!edge) break;
      pose = multiplyTransforms(edge, pose);
      frame = edge.parent;
    }
    return { transform: null, error: sourceError || `No TF path from ${source} to ${target} at message time.` };
  }
}
