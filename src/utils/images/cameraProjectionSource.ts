import type { Ros } from 'roslib';
import { buildCameraStreamUrl } from '../cameraStreamUrl';
import { CAMERA_STREAM_PRESETS, probeCameraSourceSize, resolveCameraStreamParams } from '../cameraStreamQuality';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import { subscribeToImages, type ImageEvent } from './cameraStreams';
import { subscribeToMjpeg } from './mjpegStreams';
import type { CameraImageOptions } from './cameraImageOptions';

/** Transport boundary for projection. Playback may use legacy video; projection requires acquisition metadata. */
export function subscribeToProjectionImages(
  config: {
    ros: Ros;
    topic: string;
    messageType: string;
    baseUrl: string;
    source: NonNullable<CameraImageOptions['imageSource']>;
    quality: NonNullable<CameraImageOptions['streamQuality']>;
    fallbackTopic?: string;
    fallbackType?: string;
  },
  listener: (event: ImageEvent) => void,
  onFallback: (reason: string | null) => void
) {
  const { ros, topic, messageType } = config;
  if (config.source === 'ros' || isReplayRos(ros)) return subscribeToImages(ros, topic, messageType, listener);
  let disposed = false;
  let stopVideo: (() => void) | undefined;
  let stopRos: (() => void) | undefined;
  let usingRos = false;
  let forwarded = -Infinity;
  const fallback = (reason: string) => {
    if (disposed || usingRos) return;
    usingRos = true;
    onFallback(`${reason} Using ROS image fallback.`);
    // Cached streams notify synchronously while their unsubscribe is still being installed.
    queueMicrotask(() => {
      stopVideo?.();
      stopVideo = undefined;
    });
    stopRos = subscribeToImages(ros, config.fallbackTopic ?? topic, config.fallbackType ?? messageType, event => {
      if (event.frame || event.error) listener(event);
    });
  };
  if (typeof createImageBitmap !== 'function' || typeof ReadableStream === 'undefined') {
    fallback('This browser cannot read timestamped camera streams.');
  } else
    void (async () => {
      try {
        const streamTopic = topic.replace(/\/compressed$/, '');
        const source = await probeCameraSourceSize(config.baseUrl, streamTopic);
        if (disposed) return;
        const params = source
          ? resolveCameraStreamParams({ quality: config.quality, source })
          : { quality: CAMERA_STREAM_PRESETS[config.quality].jpegQuality };
        const url = buildCameraStreamUrl({ topic: streamTopic, baseUrl: config.baseUrl, ...params });
        stopVideo = subscribeToMjpeg(ros, url, config.baseUrl, event => {
          if (disposed || usingRos) return;
          if (event.error) return fallback('Camera stream is unavailable.');
          if (!event.frame) return;
          if (event.frame.projectionError || !event.frame.header)
            return fallback('Camera stream has no valid ROS acquisition metadata.');
          // Only the 3D consumer is sampled at 10 fps. Camera keeps the source's playback rate.
          const now = performance.now();
          if (now - forwarded < 100) return;
          forwarded = now;
          listener(event);
        });
        if (disposed || usingRos) {
          stopVideo();
          stopVideo = undefined;
        }
      } catch {
        fallback('Camera stream is unavailable.');
      }
    })();
  return () => {
    disposed = true;
    stopVideo?.();
    stopRos?.();
  };
}
