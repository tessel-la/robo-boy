import { memo, useEffect, useRef, type RefObject } from 'react';
import type { Ros } from 'roslib';
import type { Viewer } from '../../utils/ros3d';
import type { CustomTFProvider } from '../../utils/tfUtils';
import type { CameraImageOptions } from '../../utils/images/cameraImageOptions';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';
import { normalizeCameraImageOptions } from '../../utils/images/cameraImageOptions';
import { subscribeToProjectionImages } from '../../utils/images/cameraProjectionSource';
import { isReplayRos } from '../../features/recordReplay/ReplaySession';
import { CameraImageClient } from '../../utils/ros3d/visualizers/CameraImage';

export default memo(function CameraImageViz({
  ros,
  viewer,
  provider,
  topic,
  messageType,
  options,
  id,
  onStatus,
  onClient,
  ready = true,
}: {
  ros: Ros;
  viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>;
  topic: string;
  messageType: string;
  options: CameraImageOptions;
  id: string;
  onStatus: (id: string, status: string | null) => void;
  onClient?: (id: string, client: CameraImageClient | null) => void;
  ready?: boolean;
}) {
  const { videoStreamBaseUrl } = useRuntimeConfig();
  const normalized = normalizeCameraImageOptions(options, topic);
  const client = useRef<CameraImageClient>();
  const latest = useRef({ options, onStatus, onClient });
  latest.current = { options, onStatus, onClient };
  useEffect(() => {
    if (!ready || !viewer.current || !provider.current) return;
    let cameraStatus: string | null = null;
    const report = () => latest.current.onStatus(id, [
      !isReplayRos(ros) && normalized.imageSource !== 'ros' && (normalized.videoTiming === 'latest' || normalized.imageSource === 'webrtc')
        ? 'Latest TF; video is not time-synchronized.' : null, cameraStatus,
    ].filter(Boolean).join(' ') || null);
    const instance = new CameraImageClient({
      ros,
      topic,
      messageType,
      options: latest.current.options,
      tfClient: provider.current,
      rootObject: viewer.current.scene,
      requestRender: viewer.current.requestRender,
      maxTextureSize: viewer.current.renderer.capabilities.maxTextureSize,
      subscribeImages: listener =>
        subscribeToProjectionImages(
          {
            ...normalized,
            ros,
            topic,
            messageType,
            baseUrl: videoStreamBaseUrl,
            source: normalized.imageSource,
            quality: normalized.streamQuality,
          },
          listener
        ),
      onStatus: value => { cameraStatus = value; report(); },
    });
    client.current = instance;
    latest.current.onClient?.(id, instance);
    const owner = viewer.current;
    return () => {
      if (instance.object) owner.resetProjection?.(instance.object.uuid);
      latest.current.onClient?.(id, null);
      instance.dispose();
      if (client.current === instance) client.current = undefined;
    };
  }, [
    ros,
    viewer,
    provider,
    topic,
    messageType,
    id,
    videoStreamBaseUrl,
    normalized.imageSource,
    normalized.streamQuality,
    normalized.projectionFps,
    normalized.whepUrl,
    normalized.videoTiming,
    normalized.opticalFrame,
    normalized.cameraInfoTopic,
    ready,
  ]);
  useEffect(() => {
    client.current?.updateOptions(options);
  }, [options]);
  return null;
});
