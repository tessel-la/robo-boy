import { buildCameraSnapshotUrl } from './cameraStreamUrl';

/**
 * web_video_server encodes every source frame at full size by default: a 1080p camera is
 * 20–80 Mbit/s of MJPEG, more than most remote links carry, so frames queue up and the picture
 * lags by seconds. A preset asks it for a smaller JPEG instead; `original` keeps its defaults.
 */
export type CameraStreamQuality = 'auto' | 'low' | 'medium' | 'high' | 'original';

interface CameraStreamPreset {
  label: string;
  /** JPEG quality, 1–100; omitted keeps web_video_server's default. */
  jpegQuality?: number;
  /** Widest frame requested; omitted keeps the source size. */
  maxWidth?: number;
  /** Size the frame to the panel it is drawn in, up to `maxWidth`. */
  fitPanel?: boolean;
}

export const CAMERA_STREAM_PRESETS: Record<CameraStreamQuality, CameraStreamPreset> = {
  auto: { label: 'Auto', jpegQuality: 60, maxWidth: 1920, fitPanel: true },
  low: { label: 'Low', jpegQuality: 40, maxWidth: 640 },
  medium: { label: 'Medium', jpegQuality: 60, maxWidth: 960 },
  high: { label: 'High', jpegQuality: 80, maxWidth: 1920 },
  original: { label: 'Original' },
};

export const CAMERA_STREAM_QUALITIES = Object.keys(CAMERA_STREAM_PRESETS) as CameraStreamQuality[];
export const DEFAULT_CAMERA_STREAM_QUALITY: CameraStreamQuality = 'auto';

/** Widths a fitted stream snaps up to, so resizing a panel restarts the stream only now and then. */
const FIT_WIDTHS = [320, 480, 640, 800, 960, 1280, 1600, 1920];

export const isCameraStreamQuality = (value: unknown): value is CameraStreamQuality =>
  typeof value === 'string' && value in CAMERA_STREAM_PRESETS;

export interface FrameSize {
  width: number;
  height: number;
}

export interface CameraStreamParams {
  width?: number;
  height?: number;
  quality?: number;
}

/**
 * The stream parameters for a preset. Width and height are only sent together, in the source's
 * aspect ratio: web_video_server stretches the frame when given one of them, and never upscales
 * here because a bigger frame than the camera's costs bandwidth without adding detail.
 */
export function resolveCameraStreamParams({
  quality,
  source,
  panel,
  devicePixelRatio = 1,
}: {
  quality: CameraStreamQuality;
  source: FrameSize | null;
  panel?: FrameSize | null;
  devicePixelRatio?: number;
}): CameraStreamParams {
  const preset = CAMERA_STREAM_PRESETS[quality];
  const params: CameraStreamParams = preset.jpegQuality ? { quality: preset.jpegQuality } : {};
  if (!preset.maxWidth || !source || source.width <= 0 || source.height <= 0) return params;

  let width = preset.maxWidth;
  if (preset.fitPanel && panel && panel.width > 0 && panel.height > 0) {
    // The image is drawn `object-fit: contain`, so the narrower of the panel's two limits wins.
    const shown = Math.min(panel.width, panel.height * (source.width / source.height));
    const needed = shown * Math.max(1, devicePixelRatio);
    width = Math.min(FIT_WIDTHS.find(candidate => candidate >= needed) ?? FIT_WIDTHS[FIT_WIDTHS.length - 1], width);
  }
  if (width >= source.width) return params;
  return { ...params, width, height: Math.max(1, Math.round((width * source.height) / source.width)) };
}

const SOURCE_PROBE_TIMEOUT_MS = 5000;
const sourceSizes = new Map<string, Promise<FrameSize | null>>();

/**
 * The camera's frame size, from one low-quality snapshot: a single JPEG, where reading it from
 * the stream would cost full-size frames. Cached per topic for the session; a failed probe is
 * forgotten so the next panel tries again.
 */
export function probeCameraSourceSize(baseUrl: string, topic: string): Promise<FrameSize | null> {
  const key = `${baseUrl}\n${topic}`;
  const cached = sourceSizes.get(key);
  if (cached) return cached;

  const probe = new Promise<FrameSize | null>(resolve => {
    if (typeof Image === 'undefined') return resolve(null);
    const image = new Image();
    const finish = (size: FrameSize | null) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      resolve(size);
    };
    const timer = setTimeout(() => finish(null), SOURCE_PROBE_TIMEOUT_MS);
    image.onload = () =>
      finish(
        image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null
      );
    image.onerror = () => finish(null);
    try {
      image.src = buildCameraSnapshotUrl({ topic, baseUrl, quality: 20 });
    } catch {
      finish(null);
    }
  });
  sourceSizes.set(key, probe);
  void probe.then(size => {
    if (!size) sourceSizes.delete(key);
  });
  return probe;
}

/** Test hook: forget every probed size. */
export function clearCameraSourceSizes(): void {
  sourceSizes.clear();
}
