import type { TransformLike } from './rosMessageUtils';

interface TfStampedLike {
  header?: { frame_id?: string };
  child_frame_id?: string;
  transform?: TransformLike;
}

export interface TfMessageLike {
  transforms?: TfStampedLike[];
}

interface CompleteTransform {
  translation: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

export interface TfGraphEntry {
  parentFrame: string;
  transform: CompleteTransform;
  isStatic: boolean;
}

export type TfGraph = Map<string, TfGraphEntry>;

const normalizeFrameId = (frameId: string) => frameId.replace(/^\/+/, '');

const normalizeTransform = (transform?: TransformLike): CompleteTransform => {
  const rotation = transform?.rotation;
  const length = Math.hypot(
    rotation?.x ?? 0,
    rotation?.y ?? 0,
    rotation?.z ?? 0,
    rotation?.w ?? 1
  ) || 1;

  return {
    translation: {
      x: transform?.translation?.x ?? 0,
      y: transform?.translation?.y ?? 0,
      z: transform?.translation?.z ?? 0,
    },
    rotation: {
      x: (rotation?.x ?? 0) / length,
      y: (rotation?.y ?? 0) / length,
      z: (rotation?.z ?? 0) / length,
      w: (rotation?.w ?? 1) / length,
    },
  };
};

const rotateVector = (
  vector: CompleteTransform['translation'],
  rotation: CompleteTransform['rotation']
) => {
  const { x, y, z } = vector;
  const { x: qx, y: qy, z: qz, w: qw } = rotation;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);

  return {
    x: x + qw * tx + (qy * tz - qz * ty),
    y: y + qw * ty + (qz * tx - qx * tz),
    z: z + qw * tz + (qx * ty - qy * tx),
  };
};

const multiplyTransforms = (first: CompleteTransform, second: CompleteTransform): CompleteTransform => {
  const rotatedTranslation = rotateVector(second.translation, first.rotation);
  const a = first.rotation;
  const b = second.rotation;

  return normalizeTransform({
    translation: {
      x: first.translation.x + rotatedTranslation.x,
      y: first.translation.y + rotatedTranslation.y,
      z: first.translation.z + rotatedTranslation.z,
    },
    rotation: {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    },
  });
};

const invertTransform = (transform: CompleteTransform): CompleteTransform => {
  const inverseRotation = {
    x: -transform.rotation.x,
    y: -transform.rotation.y,
    z: -transform.rotation.z,
    w: transform.rotation.w,
  };
  const inverseTranslation = rotateVector({
    x: -transform.translation.x,
    y: -transform.translation.y,
    z: -transform.translation.z,
  }, inverseRotation);

  return { translation: inverseTranslation, rotation: inverseRotation };
};

export function updateTfGraph(graph: TfGraph, message: TfMessageLike, isStatic: boolean) {
  message.transforms?.forEach(stamped => {
    const parentFrame = normalizeFrameId(stamped.header?.frame_id || '');
    const childFrame = normalizeFrameId(stamped.child_frame_id || '');
    if (!parentFrame || !childFrame || !stamped.transform) return;

    const existing = graph.get(childFrame);
    if (isStatic && existing && !existing.isStatic) return;
    graph.set(childFrame, {
      parentFrame,
      transform: normalizeTransform(stamped.transform),
      isStatic,
    });
  });
}

export function lookupTfTransform(
  graph: TfGraph,
  outputFrame: string,
  referenceFrame: string
): TransformLike | null {
  const target = normalizeFrameId(outputFrame);
  const source = normalizeFrameId(referenceFrame);
  const identity = normalizeTransform();
  if (target === source) return identity;

  const queue: Array<{ frame: string; transform: CompleteTransform }> = [
    { frame: source, transform: identity },
  ];
  const visited = new Set([source]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const parentEntry = graph.get(current.frame);
    if (parentEntry && !visited.has(parentEntry.parentFrame)) {
      const transform = multiplyTransforms(parentEntry.transform, current.transform);
      if (parentEntry.parentFrame === target) return transform;
      visited.add(parentEntry.parentFrame);
      queue.push({ frame: parentEntry.parentFrame, transform });
    }

    graph.forEach((entry, childFrame) => {
      if (entry.parentFrame !== current.frame || visited.has(childFrame)) return;
      const transform = multiplyTransforms(invertTransform(entry.transform), current.transform);
      if (childFrame === target) {
        queue.length = 0;
        queue.push({ frame: target, transform });
        return;
      }
      visited.add(childFrame);
      queue.push({ frame: childFrame, transform });
    });

    const resolved = queue.find(item => item.frame === target);
    if (resolved) return resolved.transform;
  }

  return null;
}
