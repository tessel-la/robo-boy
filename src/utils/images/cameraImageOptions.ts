import type { ImageGeometry } from './cameraCalibration';
import { isCameraStreamQuality, type CameraStreamQuality } from '../cameraStreamQuality';
export interface CameraImageOptions {
  imageSource?: 'ros' | 'stream';
  streamQuality?: Exclude<CameraStreamQuality, 'auto'>;
  cameraInfoTopic?: string;
  distance?: number;
  opacity?: number;
  visible?: boolean;
  showFrustum?: boolean;
  imageGeometry?: ImageGeometry;
  calibrationSync?: 'exact' | 'latest';
  toleranceMs?: number;
}
function projectionStreamQuality(value: unknown): Exclude<CameraStreamQuality, 'auto'> {
  return isCameraStreamQuality(value) && value !== 'auto' ? value : 'medium';
}
export function normalizeCameraImageOptions(options: CameraImageOptions = {}, topic = '') {
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    imageSource: options.imageSource === 'stream' ? ('stream' as const) : ('ros' as const),
    streamQuality: projectionStreamQuality(options.streamQuality),
    cameraInfoTopic: typeof options.cameraInfoTopic === 'string' ? options.cameraInfoTopic.trim() : '',
    distance: number(options.distance, 1, 0.01, 100),
    opacity: number(options.opacity, 1, 0, 1),
    visible: options.visible !== false,
    showFrustum: options.showFrustum !== false,
    imageGeometry:
      options.imageGeometry === 'raw' || options.imageGeometry === 'rectified'
        ? options.imageGeometry
        : /\/image_rect(?:_[^/]+)?(?:\/|$)/.test(topic)
          ? ('rectified' as const)
          : ('raw' as const),
    calibrationSync: options.calibrationSync === 'latest' ? ('latest' as const) : ('exact' as const),
    toleranceMs: number(options.toleranceMs, 0, 0, 1000),
  };
}
export function cameraInfoTopicFor(imageTopic: string, topics: readonly { name: string; type: string }[]) {
  const base = imageTopic.replace(/\/compressed$/, '').replace(/\/[^/]+$/, '');
  const name = `${base}/camera_info`;
  return (
    topics.find(
      topic => topic.name === name && ['sensor_msgs/CameraInfo', 'sensor_msgs/msg/CameraInfo'].includes(topic.type)
    )?.name ?? ''
  );
}
