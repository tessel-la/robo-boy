import type { Ros } from 'roslib';
import ROSLIB from 'roslib';
import type { GamepadComponentConfig } from './types';

export interface TopicInfo {
  name: string;
  type: string;
}

export interface NumericFieldOption {
  path: string;
  label: string;
  rosType: string;
}

interface FieldTypedef {
  type: string;
  fieldnames?: string[];
  fieldtypes?: string[];
  fieldarraylen?: number[];
}

const NUMERIC_TYPES = new Set([
  'byte',
  'char',
  'int',
  'uint',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'float',
  'double',
  'float32',
  'float64',
]);

export const CAMERA_MESSAGE_TYPES = [
  'sensor_msgs/Image',
  'sensor_msgs/msg/Image',
  'sensor_msgs/CompressedImage',
  'sensor_msgs/msg/CompressedImage',
];

export const JOY_MESSAGE_TYPES = [
  'sensor_msgs/Joy',
  'sensor_msgs/msg/Joy',
];

export const POSE_STAMPED_MESSAGE_TYPES = [
  'geometry_msgs/PoseStamped',
  'geometry_msgs/msg/PoseStamped',
];

export const ODOMETRY_MESSAGE_TYPES = [
  'nav_msgs/Odometry',
  'nav_msgs/msg/Odometry',
];

const DYNAMIC_ARRAY_PREVIEW_LENGTH = 8;

const COMMON_NUMERIC_FIELDS: Record<string, NumericFieldOption[]> = {
  'std_msgs/Float32': [{ path: 'data', label: 'data', rosType: 'float32' }],
  'std_msgs/msg/Float32': [{ path: 'data', label: 'data', rosType: 'float32' }],
  'std_msgs/Float64': [{ path: 'data', label: 'data', rosType: 'float64' }],
  'std_msgs/msg/Float64': [{ path: 'data', label: 'data', rosType: 'float64' }],
  'std_msgs/Int32': [{ path: 'data', label: 'data', rosType: 'int32' }],
  'std_msgs/msg/Int32': [{ path: 'data', label: 'data', rosType: 'int32' }],
  'std_msgs/Int64': [{ path: 'data', label: 'data', rosType: 'int64' }],
  'std_msgs/msg/Int64': [{ path: 'data', label: 'data', rosType: 'int64' }],
  'geometry_msgs/Twist': [
    { path: 'linear.x', label: 'linear.x', rosType: 'float64' },
    { path: 'linear.y', label: 'linear.y', rosType: 'float64' },
    { path: 'linear.z', label: 'linear.z', rosType: 'float64' },
    { path: 'angular.x', label: 'angular.x', rosType: 'float64' },
    { path: 'angular.y', label: 'angular.y', rosType: 'float64' },
    { path: 'angular.z', label: 'angular.z', rosType: 'float64' },
  ],
  'geometry_msgs/msg/Twist': [
    { path: 'linear.x', label: 'linear.x', rosType: 'float64' },
    { path: 'linear.y', label: 'linear.y', rosType: 'float64' },
    { path: 'linear.z', label: 'linear.z', rosType: 'float64' },
    { path: 'angular.x', label: 'angular.x', rosType: 'float64' },
    { path: 'angular.y', label: 'angular.y', rosType: 'float64' },
    { path: 'angular.z', label: 'angular.z', rosType: 'float64' },
  ],
  'sensor_msgs/Joy': [
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `axes[${index}]`,
      label: `axes[${index}]`,
      rosType: 'float32',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `buttons[${index}]`,
      label: `buttons[${index}]`,
      rosType: 'int32',
    })),
  ],
  'sensor_msgs/msg/Joy': [
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `axes[${index}]`,
      label: `axes[${index}]`,
      rosType: 'float32',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `buttons[${index}]`,
      label: `buttons[${index}]`,
      rosType: 'int32',
    })),
  ],
  'sensor_msgs/JointState': [
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `position[${index}]`,
      label: `position[${index}]`,
      rosType: 'float64',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `velocity[${index}]`,
      label: `velocity[${index}]`,
      rosType: 'float64',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `effort[${index}]`,
      label: `effort[${index}]`,
      rosType: 'float64',
    })),
  ],
  'sensor_msgs/msg/JointState': [
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `position[${index}]`,
      label: `position[${index}]`,
      rosType: 'float64',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `velocity[${index}]`,
      label: `velocity[${index}]`,
      rosType: 'float64',
    })),
    ...Array.from({ length: DYNAMIC_ARRAY_PREVIEW_LENGTH }, (_, index) => ({
      path: `effort[${index}]`,
      label: `effort[${index}]`,
      rosType: 'float64',
    })),
  ],
};

export function isCameraMessageType(type: string): boolean {
  return CAMERA_MESSAGE_TYPES.includes(type);
}

export function isJoyMessageType(type: string): boolean {
  return JOY_MESSAGE_TYPES.includes(type);
}

export function isPoseStampedMessageType(type: string): boolean {
  return POSE_STAMPED_MESSAGE_TYPES.includes(type);
}

export function isOdometryMessageType(type: string): boolean {
  return ODOMETRY_MESSAGE_TYPES.includes(type);
}

export function filterCameraTopics(topics: TopicInfo[]): TopicInfo[] {
  return topics.filter(topic => isCameraMessageType(topic.type));
}

export function filterOdometryTopics(topics: TopicInfo[]): TopicInfo[] {
  return topics.filter(topic => isOdometryMessageType(topic.type));
}

export interface OdometryLikeMessage {
  header?: {
    frame_id?: string;
  };
  pose?: {
    pose?: {
      position?: Partial<Record<'x' | 'y' | 'z', number>>;
      orientation?: Partial<Record<'x' | 'y' | 'z' | 'w', number>>;
    };
  };
}

export interface TransformLike {
  translation?: Partial<Record<'x' | 'y' | 'z', number>>;
  rotation?: Partial<Record<'x' | 'y' | 'z' | 'w', number>>;
}

export function buildStampedHeader(messageType: string, frameId: string, date = new Date()) {
  const millis = date.getTime();
  const seconds = Math.floor(millis / 1000);
  const nanos = Math.floor((millis - seconds * 1000) * 1_000_000);

  return {
    stamp: messageType.includes('/msg/')
      ? { sec: seconds, nanosec: nanos }
      : { secs: seconds, nsecs: nanos },
    frame_id: frameId,
  };
}

export function buildTwistPayload({
  messageType,
  axes,
  values,
  frameId = 'panda_link0',
  date,
}: {
  messageType: string;
  axes: string[];
  values: number[];
  frameId?: string;
  date?: Date;
}) {
  const linear = { x: 0, y: 0, z: 0 };
  const angular = { x: 0, y: 0, z: 0 };

  axes.forEach((path, index) => {
    if (index >= values.length) return;
    const [group, axis] = path.replace(/^twist\./, '').split('.');
    if ((group === 'linear' || group === 'angular') && axis in linear) {
      (group === 'linear' ? linear : angular)[axis as keyof typeof linear] = values[index];
    }
  });

  const twist = { linear, angular };
  return messageType.includes('TwistStamped')
    ? { header: buildStampedHeader(messageType, frameId, date), twist }
    : twist;
}

export function mergeJoyAxes(
  currentAxes: number[],
  axisMappings: string[],
  values: number[],
  minimumAxisCount = 4
): number[] {
  const numericMappings = axisMappings
    .map(mapping => Number.parseInt(mapping, 10))
    .filter(index => Number.isInteger(index) && index >= 0);
  const highestAxis = numericMappings.length > 0 ? Math.max(...numericMappings) : -1;
  const axes = Array(Math.max(minimumAxisCount, currentAxes.length, highestAxis + 1)).fill(0);

  currentAxes.forEach((value, index) => {
    axes[index] = value;
  });
  axisMappings.forEach((mapping, valueIndex) => {
    const axisIndex = Number.parseInt(mapping, 10);
    if (Number.isInteger(axisIndex) && axisIndex >= 0 && valueIndex < values.length) {
      axes[axisIndex] = values[valueIndex];
    }
  });

  return axes;
}

function writePoseAxis(
  position: Record<'x' | 'y' | 'z', number>,
  axisPath: string,
  value: number
) {
  const normalized = axisPath.replace(/^pose\./, '');
  const component = normalized.startsWith('position.')
    ? normalized.split('.')[1]
    : normalized;

  if (component === 'x' || component === 'y' || component === 'z') {
    position[component] = value;
  }
}

export function buildPoseStampedPayload({
  messageType,
  config,
  values,
  latestOdometry,
  latestReferenceTransform,
  date,
}: {
  messageType: string;
  config: GamepadComponentConfig;
  values: number[];
  latestOdometry?: OdometryLikeMessage | null;
  latestReferenceTransform?: TransformLike | null;
  date?: Date;
}) {
  const frameId = config.config?.poseStampedFrameId?.trim()
    || latestOdometry?.header?.frame_id?.trim()
    || 'map';
  const axesConfig = config.config?.axes?.length
    ? config.config.axes
    : ['position.x', 'position.y'];
  const offset = { x: 0, y: 0, z: 0 };

  axesConfig.forEach((axis, index) => {
    if (index < values.length) {
      writePoseAxis(offset, axis, values[index]);
    }
  });

  const odometryPose = latestOdometry?.pose?.pose;
  const useOdometry = config.config?.poseStampedReferenceMode === 'odometry' && !!odometryPose;
  const useReferenceTransform = config.config?.poseStampedReferenceMode === 'tf'
    && !!latestReferenceTransform;
  const basePosition = odometryPose?.position;
  const referenceTranslation = latestReferenceTransform?.translation;
  const referenceRotation = latestReferenceTransform?.rotation;
  const quaternionLength = Math.hypot(
    referenceRotation?.x ?? 0,
    referenceRotation?.y ?? 0,
    referenceRotation?.z ?? 0,
    referenceRotation?.w ?? 1
  ) || 1;
  const normalizedReferenceRotation = {
    x: (referenceRotation?.x ?? 0) / quaternionLength,
    y: (referenceRotation?.y ?? 0) / quaternionLength,
    z: (referenceRotation?.z ?? 0) / quaternionLength,
    w: (referenceRotation?.w ?? 1) / quaternionLength,
  };
  const { x: qx, y: qy, z: qz, w: qw } = normalizedReferenceRotation;
  const tx = 2 * (qy * offset.z - qz * offset.y);
  const ty = 2 * (qz * offset.x - qx * offset.z);
  const tz = 2 * (qx * offset.y - qy * offset.x);
  const rotatedOffset = {
    x: offset.x + qw * tx + (qy * tz - qz * ty),
    y: offset.y + qw * ty + (qz * tx - qx * tz),
    z: offset.z + qw * tz + (qx * ty - qy * tx),
  };
  const position = useReferenceTransform
    ? {
      x: (referenceTranslation?.x ?? 0) + rotatedOffset.x,
      y: (referenceTranslation?.y ?? 0) + rotatedOffset.y,
      z: (referenceTranslation?.z ?? 0) + rotatedOffset.z,
    }
    : {
      x: (useOdometry ? basePosition?.x ?? 0 : 0) + offset.x,
      y: (useOdometry ? basePosition?.y ?? 0 : 0) + offset.y,
      z: (useOdometry ? basePosition?.z ?? 0 : 0) + offset.z,
    };
  const odometryOrientation = odometryPose?.orientation;
  const orientation = useReferenceTransform
    ? normalizedReferenceRotation
    : (useOdometry && config.config?.poseStampedUseOdometryOrientation !== false)
    ? {
      x: odometryOrientation?.x ?? 0,
      y: odometryOrientation?.y ?? 0,
      z: odometryOrientation?.z ?? 0,
      w: odometryOrientation?.w ?? 1,
    }
    : { x: 0, y: 0, z: 0, w: 1 };

  return {
    header: buildStampedHeader(messageType, frameId, date),
    pose: {
      position,
      orientation,
    },
  };
}

export function buildCameraStreamUrl({
  topic,
  streamType = 'mjpeg',
  width,
  height,
}: {
  topic: string;
  streamType?: string;
  width?: number;
  height?: number;
}): string {
  let url = `/video_stream/stream?topic=${topic}`;
  if (streamType) url += `&type=${streamType}`;
  if (width) url += `&width=${width}`;
  if (height) url += `&height=${height}`;
  return url;
}

function isNumericRosType(type: string): boolean {
  return NUMERIC_TYPES.has(type.replace(/\[\]$/, ''));
}

function findTypedef(typedefs: FieldTypedef[], type: string): FieldTypedef | undefined {
  const lastPart = type.split('/').pop();
  return typedefs.find(item => item.type === type || item.type.split('/').pop() === lastPart);
}

function appendIndexedFields(
  fields: NumericFieldOption[],
  prefix: string,
  fieldType: string,
  arrayLen: number
) {
  const length = arrayLen > 0 ? arrayLen : DYNAMIC_ARRAY_PREVIEW_LENGTH;
  for (let index = 0; index < length; index += 1) {
    const path = `${prefix}[${index}]`;
    fields.push({ path, label: path, rosType: fieldType });
  }
}

function flattenNumericFieldsFromTypedef(
  typedef: FieldTypedef,
  typedefs: FieldTypedef[],
  prefix = '',
  depth = 0
): NumericFieldOption[] {
  if (depth > 4) return [];

  const fields: NumericFieldOption[] = [];
  const names = typedef.fieldnames ?? [];
  const types = typedef.fieldtypes ?? [];
  const arrayLens = typedef.fieldarraylen ?? [];

  names.forEach((name, index) => {
    const fieldType = types[index] ?? '';
    const arrayLen = arrayLens[index] ?? -1;
    const path = prefix ? `${prefix}.${name}` : name;

    if (isNumericRosType(fieldType)) {
      if (arrayLen >= 0) {
        appendIndexedFields(fields, path, fieldType, arrayLen);
      } else {
        fields.push({ path, label: path, rosType: fieldType });
      }
      return;
    }

    if (arrayLen >= 0) return;

    const nested = findTypedef(typedefs, fieldType);
    if (nested) {
      fields.push(...flattenNumericFieldsFromTypedef(nested, typedefs, path, depth + 1));
    }
  });

  return fields;
}

export function flattenNumericFields(typedefs: FieldTypedef[], messageType: string): NumericFieldOption[] {
  const root = findTypedef(typedefs, messageType) ?? typedefs.find(item => item.fieldnames?.length);
  if (!root) return COMMON_NUMERIC_FIELDS[messageType] ?? [];

  const fields = flattenNumericFieldsFromTypedef(root, typedefs);
  return fields.length > 0 ? fields : (COMMON_NUMERIC_FIELDS[messageType] ?? []);
}

export async function fetchNumericFields(ros: Ros, messageType: string): Promise<NumericFieldOption[]> {
  if (!messageType) return [];

  return new Promise(resolve => {
    try {
      const service = new ROSLIB.Service({
        ros,
        name: '/rosapi/message_details',
        serviceType: 'rosapi_msgs/srv/MessageDetails',
      });

      service.callService(
        { type: messageType },
        (response: { typedefs?: FieldTypedef[] }) => {
          resolve(flattenNumericFields(response.typedefs ?? [], messageType));
        },
        () => resolve(COMMON_NUMERIC_FIELDS[messageType] ?? [])
      );
    } catch {
      resolve(COMMON_NUMERIC_FIELDS[messageType] ?? []);
    }
  });
}

function readPathSegment(value: unknown, segment: string): unknown {
  const match = segment.match(/^([^\[]+)(?:\[(\d+)\])?$/);
  if (!match || value === null || typeof value !== 'object') return undefined;

  const objectValue = value as Record<string, unknown>;
  const next = objectValue[match[1]];
  if (match[2] === undefined) return next;

  if (!Array.isArray(next)) return undefined;
  return next[Number(match[2])];
}

export function getValueAtPath(message: unknown, fieldPath: string): unknown {
  if (!fieldPath) return null;

  return fieldPath.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    return readPathSegment(current, segment);
  }, message);
}

export function getNumericValueAtPath(message: unknown, fieldPath: string): number | null {
  const value = getValueAtPath(message, fieldPath);

  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export interface PlotSample {
  time: number;
  value: number;
}

export function trimPlotSamples(
  samples: PlotSample[],
  now: number,
  timeWindowSec: number,
  sampleLimit: number
): PlotSample[] {
  const minTime = now - Math.max(1, timeWindowSec) * 1000;
  const byTime = samples.filter(sample => sample.time >= minTime);
  return byTime.slice(Math.max(0, byTime.length - Math.max(1, sampleLimit)));
}

export function getPlotRange(samples: PlotSample[], autoScale: boolean, minY = -1, maxY = 1) {
  if (!autoScale) {
    return minY === maxY ? { min: minY - 1, max: maxY + 1 } : { min: minY, max: maxY };
  }

  if (samples.length === 0) return { min: -1, max: 1 };

  const values = samples.map(sample => sample.value);
  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    min -= 1;
    max += 1;
  } else {
    const padding = (max - min) * 0.1;
    min -= padding;
    max += padding;
  }

  return { min, max };
}
