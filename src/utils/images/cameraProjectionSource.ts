import { subscribeToWebRtcFrames, type WebRtcOptions } from './webrtcStreams';
import type { Ros } from 'roslib';
import { buildCameraStreamUrl } from '../cameraStreamUrl';
import { CAMERA_STREAM_PRESETS, probeCameraSourceSize, resolveCameraStreamParams } from '../cameraStreamQuality';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import { subscribeToCameraInfo, subscribeToImages, type ImageEvent } from './cameraStreams';
import { subscribeToMjpeg } from './mjpegStreams';
import { cameraPanelTopic, type CameraImageOptions } from './cameraImageOptions';

/** Transport boundary: recorded/ROS timestamps or explicitly chosen latest-TF video. */
export function subscribeToProjectionImages(
  config: Pick<CameraImageOptions, 'videoTiming' | 'opticalFrame' | 'projectionFps'> &
    WebRtcOptions & {
      cameraInfoTopic?: string;
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
  const options = { ...config };
  const fps =
    typeof config.projectionFps === 'number' && Number.isFinite(config.projectionFps)
      ? Math.min(60, Math.max(0, config.projectionFps))
      : 10;
  let forwarded = -Infinity;
  const forward = (event: ImageEvent) => {
    if (event.frame && !event.error) {
      const now = performance.now();
      if (fps && now - forwarded < 1000 / fps) return;
      forwarded = now;
    }
    listener(event);
  };
  let stopInfo: (() => void) | undefined;
  if (
    (options.videoTiming === 'latest' || options.source === 'webrtc') &&
    !options.opticalFrame &&
    options.cameraInfoTopic
  )
    stopInfo = subscribeToCameraInfo(ros, options.cameraInfoTopic, event => {
      options.opticalFrame = event.samples[event.samples.length - 1]?.frame;
    });
  if (config.source === 'webrtc') {
    try {
      if (!options.whepUrl) throw new Error('Choose a WebRTC stream or enter its WHEP URL.');
      const stop = subscribeToWebRtcFrames(
        ros,
        options.whepUrl,
        event => {
          if (!event.frame || event.error) return forward(event);
          if (!options.opticalFrame)
            return listener({ frame: null, error: 'Waiting for CameraInfo to identify the optical frame.' });
          forward({
            frame: { ...event.frame, header: { frame_id: options.opticalFrame, stamp: { sec: 0, nanosec: 0 } } },
            error: null,
          });
        },
        fps
      );
      return () => {
        stop();
        stopInfo?.();
      };
    } catch (error) {
      listener({ frame: null, error: error instanceof Error ? error.message : 'WebRTC is unavailable.' });
      return () => stopInfo?.();
    }
  }

  let disposed = false;
  let stopVideo: (() => void) | undefined;
  let failed = false;
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
        const streamTopic = cameraPanelTopic(topic, 'stream');
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
          if (options.videoTiming !== 'latest' && (event.frame.projectionError || !event.frame.header))
            return fail(
              'Camera stream has no valid ROS acquisition metadata. Select Latest TF explicitly for an unsynchronized stream.'
            );
          if ((options.videoTiming === 'latest' || options.source === 'webrtc') && !options.opticalFrame) {
            listener({ frame: null, error: 'Waiting for CameraInfo to identify the optical frame.' });
            return;
          }
          // Sampling affects only this 3D consumer, never Camera playback.
          forward(
            options.videoTiming === 'latest'
              ? {
                  frame: {
                    ...event.frame,
                    acquisitionHeader: event.frame.header,
                    projectionError: undefined,
                    header: { frame_id: options.opticalFrame, stamp: { sec: 0, nanosec: 0 } },
                    sourceSize: event.frame.sourceSize ?? source ?? undefined,
                  },
                  error: null,
                }
              : event
          );
        });
        if (disposed || failed) stopStream();
      } catch (error) {
        fail(error instanceof Error ? `Camera streamer: ${error.message}` : 'Camera streamer is unavailable.');
      }
    })();
  return () => {
    disposed = true;
    stopStream();
    stopInfo?.();
  };
}
