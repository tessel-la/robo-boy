import * as THREE from 'three';

import { invertTransform, multiplyTransforms, type StoredTransform } from '../../utils/tfUtils';
import { normalizeFrameId, type TfQuaternion, type TfTreeState, type TfVector3 } from './tfTreeModel';

export interface TfCalculatedTransform {
  sourceFrame: string;
  targetFrame: string;
  translation: TfVector3;
  rotation: TfQuaternion;
  path: string[];
}

interface TfGraphStep {
  frame: string;
  transform: StoredTransform;
}

const identityTransform = (): StoredTransform => ({
  translation: new THREE.Vector3(),
  rotation: new THREE.Quaternion(),
});

const recordTransform = (translation: TfVector3 | null, rotation: TfQuaternion | null): StoredTransform | null => {
  if (!translation || !rotation) return null;
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  if (quaternion.lengthSq() === 0) return null;

  return {
    translation: new THREE.Vector3(translation.x, translation.y, translation.z),
    rotation: quaternion.normalize(),
  };
};

/** Returns the latest target-frame pose relative to the source frame, matching tf2_echo source/target ordering. */
export const calculateTfBetweenFrames = (
  state: TfTreeState,
  sourceFrameInput: string,
  targetFrameInput: string
): TfCalculatedTransform | null => {
  const sourceFrame = normalizeFrameId(sourceFrameInput);
  const targetFrame = normalizeFrameId(targetFrameInput);
  if (!sourceFrame || !targetFrame || !state.knownFrames.has(sourceFrame) || !state.knownFrames.has(targetFrame)) {
    return null;
  }

  if (sourceFrame === targetFrame) {
    return {
      sourceFrame,
      targetFrame,
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      path: [sourceFrame],
    };
  }

  const adjacency = new Map<string, TfGraphStep[]>();
  state.knownFrames.forEach(frame => adjacency.set(frame, []));
  state.transformsByChild.forEach(record => {
    const transform = recordTransform(record.translation, record.rotation);
    if (!transform) return;
    adjacency.get(record.parentFrame)?.push({ frame: record.childFrame, transform });
    adjacency.get(record.childFrame)?.push({ frame: record.parentFrame, transform: invertTransform(transform) });
  });

  const queue: Array<{ frame: string; transform: StoredTransform; path: string[] }> = [
    { frame: sourceFrame, transform: identityTransform(), path: [sourceFrame] },
  ];
  const visited = new Set([sourceFrame]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of adjacency.get(current.frame) ?? []) {
      if (visited.has(step.frame)) continue;
      const transform = multiplyTransforms(current.transform, step.transform);
      const path = [...current.path, step.frame];
      if (step.frame === targetFrame) {
        transform.rotation.normalize();
        return {
          sourceFrame,
          targetFrame,
          translation: {
            x: transform.translation.x,
            y: transform.translation.y,
            z: transform.translation.z,
          },
          rotation: {
            x: transform.rotation.x,
            y: transform.rotation.y,
            z: transform.rotation.z,
            w: transform.rotation.w,
          },
          path,
        };
      }
      visited.add(step.frame);
      queue.push({ frame: step.frame, transform, path });
    }
  }

  return null;
};

export const quaternionToRotationMatrix = (rotation: TfQuaternion): number[][] => {
  const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
  const elements = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements;
  return [
    [elements[0], elements[4], elements[8]],
    [elements[1], elements[5], elements[9]],
    [elements[2], elements[6], elements[10]],
  ];
};
