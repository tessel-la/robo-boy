import type { Ros } from 'roslib';
import ROSLIB from 'roslib';

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

export function filterCameraTopics(topics: TopicInfo[]): TopicInfo[] {
  return topics.filter(topic => isCameraMessageType(topic.type));
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

export function getNumericValueAtPath(message: unknown, fieldPath: string): number | null {
  if (!fieldPath) return null;

  const value = fieldPath.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) return undefined;
    return readPathSegment(current, segment);
  }, message);

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
