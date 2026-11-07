import { getUrdfTopics, type RosTopicInfo } from './urdfTopics';

/** Display-only joint telemetry. Limits come from URDF, never from observed extrema. */
export interface JointSample {
  name: string;
  position?: number;
  velocity?: number;
  effort?: number;
  receivedAt: number;
}
export interface JointLimits {
  type: string;
  lower?: number;
  upper?: number;
  velocity?: number;
  effort?: number;
}
export interface OverlayFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface JointStateOptions {
  visible?: boolean;
  backgroundOpacity?: number;
  angleUnit?: 'rad' | 'deg';
  filter?: string;
  showVelocity?: boolean;
  showEffort?: boolean;
  robotDescriptionTopic?: string;
  frame?: OverlayFrame;
}
export function normalizeJointStateOptions(options: JointStateOptions = {}) {
  return {
    ...options,
    visible: options.visible !== false,
    backgroundOpacity:
      typeof options.backgroundOpacity === 'number' && Number.isFinite(options.backgroundOpacity)
        ? Math.max(0, Math.min(1, options.backgroundOpacity))
        : 0.9,
    angleUnit: options.angleUnit === 'deg' ? ('deg' as const) : ('rad' as const),
    filter: typeof options.filter === 'string' ? options.filter.slice(0, 128) : '',
    showVelocity: options.showVelocity === true,
    showEffort: options.showEffort === true,
  };
}
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
export function parseJointState(message: unknown, receivedAt: number): JointSample[] {
  const m = message as Record<string, unknown> | null;
  if (
    !m ||
    !Array.isArray(m.name) ||
    m.name.length > 2048 ||
    m.name.some(name => typeof name !== 'string' || !name || name.length > 512) ||
    new Set(m.name).size !== m.name.length
  )
    throw new Error('Invalid JointState joint names.');
  const names = m.name as string[];
  const arrays = ['position', 'velocity', 'effort'].map(field => {
    const values = m[field] ?? [];
    if (
      (!Array.isArray(values) && !ArrayBuffer.isView(values)) ||
      ((values as ArrayLike<unknown>).length !== 0 && (values as ArrayLike<unknown>).length !== names.length)
    )
      throw new Error(`JointState ${field} must be empty or match the joint names.`);
    return values as ArrayLike<unknown>;
  });
  return names.map((name, i) => ({
    name,
    position: finite(arrays[0][i]),
    velocity: finite(arrays[1][i]),
    effort: finite(arrays[2][i]),
    receivedAt,
  }));
}
export function parseJointLimits(xml: unknown): Record<string, JointLimits> {
  if (typeof xml !== 'string' || xml.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Invalid robot description.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'robot') throw new Error('Invalid URDF XML.');
  const joints = Array.from(doc.documentElement.children).filter(element => element.tagName === 'joint');
  if (joints.length > 4096) throw new Error('Robot description has too many joints.');
  const result: Record<string, JointLimits> = Object.create(null);
  for (const joint of joints) {
    const name = joint.getAttribute('name'),
      type = joint.getAttribute('type');
    if (!name || !type || Object.prototype.hasOwnProperty.call(result, name))
      throw new Error('Invalid URDF joint names.');
    const limit = Array.from(joint.children).find(child => child.tagName === 'limit');
    const read = (attribute: string) => {
      const raw = limit?.getAttribute(attribute);
      if (raw == null) return undefined;
      const value = raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(value)) throw new Error(`Invalid limits for ${name}.`);
      return value;
    };
    const lower = type === 'revolute' || type === 'prismatic' ? read('lower') : undefined;
    const upper = type === 'revolute' || type === 'prismatic' ? read('upper') : undefined;
    const velocity = read('velocity'),
      effort = read('effort');
    if (
      (lower !== undefined && upper !== undefined && lower > upper) ||
      (velocity !== undefined && velocity < 0) ||
      (effort !== undefined && effort < 0)
    )
      throw new Error(`Invalid limits for ${name}.`);
    result[name] = { type, lower, upper, velocity, effort };
  }
  return result;
}
export function clampOverlayFrame(frame: OverlayFrame | undefined, width: number, height: number): OverlayFrame {
  const valid = frame && [frame.left, frame.top, frame.width, frame.height].every(Number.isFinite);
  const w = Math.min(Math.max(1, width - 16), Math.max(240, valid ? frame.width : 320));
  const h = Math.min(Math.max(1, height - 16), Math.max(140, valid ? frame.height : 300));
  return {
    width: w,
    height: h,
    left: Math.max(8, Math.min(valid ? frame.left : width - w - 12, width - w - 8)),
    top: Math.max(8, Math.min(valid ? frame.top : 12, height - h - 8)),
  };
}

/** Prefer a description in the same namespace; never pick another robot arbitrarily. */
export function jointDescriptionTopic(topic: string, topics: RosTopicInfo[]) {
  const descriptions = getUrdfTopics(topics);
  const sibling = `${topic.slice(0, topic.lastIndexOf('/') + 1)}robot_description`;
  return (
    descriptions.find(item => item.name === sibling)?.name ??
    descriptions.find(item => item.name === '/robot_description')?.name ??
    ''
  );
}
