import type { CustomGamepadLayout } from '../../../features/customGamepad/types';
import { getConnectionStorageKey } from '../../../runtime/connectionStorage';
import type { XrPose } from '../../types';

export type PadPoses = Record<string, XrPose>;
export const padPoseKey = (layoutId: string, scope?: string) =>
  getConnectionStorageKey(`robo-boy-xr-pad-v1:${layoutId}`, scope);

// These placements belong only to XR. The desktop's integer grid is never a projection of them.
export function readPadPoses(layoutId: string, scope?: string): PadPoses {
  const poses: PadPoses = Object.create(null) as PadPoses;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(padPoseKey(layoutId, scope)) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return poses;
    for (const [id, value] of Object.entries(stored)) {
      const pose = value as Partial<XrPose> | null;
      if (
        !pose ||
        !Array.isArray(pose.position) ||
        pose.position.length !== 3 ||
        !pose.position.every(Number.isFinite) ||
        !Array.isArray(pose.quaternion) ||
        pose.quaternion.length !== 4 ||
        !pose.quaternion.every(Number.isFinite) ||
        typeof pose.scale !== 'number' ||
        !Number.isFinite(pose.scale) ||
        pose.scale < 0.4 ||
        pose.scale > 2 ||
        Math.hypot(...pose.position) > 1.5 ||
        Math.hypot(...pose.quaternion) < 0.001
      )
        continue;
      poses[id] = pose as XrPose;
    }
    return poses;
  } catch {
    return poses;
  }
}

export function padDimensions(layout: CustomGamepadLayout) {
  const cell = Math.min(0.82 / Math.max(1, layout.gridSize.width), 0.52 / Math.max(1, layout.gridSize.height));
  return { cell, width: cell * layout.gridSize.width, height: cell * layout.gridSize.height };
}

export function defaultControlPose(
  layout: CustomGamepadLayout,
  rect: CustomGamepadLayout['components'][number]['position']
): XrPose {
  const { cell, width, height } = padDimensions(layout);
  return {
    position: [
      -width / 2 + (rect.x + rect.width / 2) * cell,
      0.3 + height / 2 - (rect.y + rect.height / 2) * cell,
      0.025,
    ],
    quaternion: [0, 0, 0, 1],
    scale: 1,
  };
}
