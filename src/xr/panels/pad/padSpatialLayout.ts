import type { CustomGamepadLayout } from '../../../features/customGamepad/types';
import { isAreaFree, type GridRect } from '../../../features/customGamepad/padGeometry';
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

/** A scaled control reserves whole cells; drops always align with the Pad board. */
export function padGridDestination(
  layout: CustomGamepadLayout,
  component: CustomGamepadLayout['components'][number],
  desired: XrPose
): { rect: GridRect; pose: XrPose } {
  const { cell, width, height } = padDimensions(layout);
  const scale = Math.max(
    0.4,
    Math.min(
      2,
      desired.scale,
      layout.gridSize.width / component.position.width,
      layout.gridSize.height / component.position.height
    )
  );
  const rectWidth = Math.ceil(component.position.width * scale - 1e-6);
  const rectHeight = Math.ceil(component.position.height * scale - 1e-6);
  const rect = {
    x: Math.max(
      0,
      Math.min(layout.gridSize.width - rectWidth, Math.round((desired.position[0] + width / 2) / cell - rectWidth / 2))
    ),
    y: Math.max(
      0,
      Math.min(
        layout.gridSize.height - rectHeight,
        Math.round((0.3 + height / 2 - desired.position[1]) / cell - rectHeight / 2)
      )
    ),
    width: rectWidth,
    height: rectHeight,
  };
  return { rect, pose: { ...defaultControlPose(layout, rect), scale } };
}

export function snapPadPose(
  layout: CustomGamepadLayout,
  component: CustomGamepadLayout['components'][number],
  desired: XrPose,
  poses: PadPoses
): XrPose | null {
  const destination = padGridDestination(layout, component, desired);
  const occupied = layout.components
    .filter(c => c.id !== component.id)
    .map(c => padGridDestination(layout, c, poses[c.id] ?? defaultControlPose(layout, c.position)).rect);
  return isAreaFree(destination.rect, layout.gridSize, occupied) ? destination.pose : null;
}

/** Migrate old free placements without allowing an overlap or changing the desktop layout. */
export function normalizePadPoses(layout: CustomGamepadLayout, stored: PadPoses): PadPoses {
  const poses: PadPoses = Object.create(null) as PadPoses;
  const defaults: PadPoses = Object.create(null) as PadPoses;
  const candidates = new Set<string>();
  for (const c of layout.components) {
    defaults[c.id] = defaultControlPose(layout, c.position);
    poses[c.id] = stored[c.id] ? padGridDestination(layout, c, stored[c.id]).pose : defaults[c.id];
    if (stored[c.id]) candidates.add(c.id);
  }
  // Restore colliding candidates together, then check again: a restored default may occupy
  // a different candidate's destination. Each pass removes at least one candidate.
  while (candidates.size) {
    const blocked = layout.components.filter(c => candidates.has(c.id) && !snapPadPose(layout, c, poses[c.id], poses));
    if (!blocked.length) break;
    for (const c of blocked) {
      poses[c.id] = defaults[c.id];
      candidates.delete(c.id);
    }
  }
  return poses;
}
