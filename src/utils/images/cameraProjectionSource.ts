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
  },
  listener: (event: ImageEvent) => void
) {
  const { ros, topic, messageType } = config;
  if (config.source === 'ros' || isReplayRos(ros)) return subscribeToImages(ros, topic, messageType, listener);
  let disposed = false;
  let stopVideo: (() => void) | undefined;
  let failed = false;
  let forwarded = -Infinity;
  const stopStream = () => {
    const stop = stopVideo;
    stopVideo = undefined;
    stop?.();
  };
  const fail = (reason: string) => {
    if (disposed || failed) return;
    failed = true;
    // Cached streams notify synchronously while their unsubscribe is still being installed.
    queueMicrotask(stopStream);
    listener({
      frame: null,
      error: `${reason} Select ROS image messages in Image source to use ROS instead.`,
    });
  };
  if (typeof createImageBitmap !== 'function' || typeof ReadableStream === 'undefined') {
    fail('This browser cannot read timestamped camera streams.');
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
          if (disposed || failed) return;
          if (event.error) return fail(`Camera streamer: ${event.error}`);
          if (!event.frame) return;
          if (event.frame.projectionError || !event.frame.header)
            return fail('Camera stream has no valid ROS acquisition metadata.');
          // Only the 3D consumer is sampled at 10 fps. Camera keeps the source's playback rate.
          const now = performance.now();
          if (now - forwarded < 100) return;
          forwarded = now;
          listener(event);
        });
        if (disposed || failed) stopStream();
      } catch (error) {
        fail(error instanceof Error ? `Camera streamer: ${error.message}` : 'Camera streamer is unavailable.');
      }
    })();
  return () => {
    disposed = true;
    stopStream();
  };
}
