import { memo, useEffect, useRef, type RefObject } from 'react';
import type { Ros } from 'roslib';
import type { Viewer } from '../../utils/ros3d';
import type { CustomTFProvider } from '../../utils/tfUtils';
import type { CameraImageOptions } from '../../utils/images/cameraImageOptions';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';
import { normalizeCameraImageOptions } from '../../utils/images/cameraImageOptions';
import { subscribeToProjectionImages } from '../../utils/images/cameraProjectionSource';
import { COMPRESSED_IMAGE_TYPES } from '../../utils/images/imageFrames';
import { CameraImageClient } from '../../utils/ros3d/visualizers/CameraImage';

export default memo(function CameraImageViz({
  ros,
  viewer,
  provider,
  topic,
  messageType,
  options,
  topics,
  id,
  onStatus,
}: {
  ros: Ros;
  viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>;
  topic: string;
  messageType: string;
  options: CameraImageOptions;
  topics: { name: string; type: string }[];
  id: string;
  onStatus: (id: string, status: string | null) => void;
}) {
  const { videoStreamBaseUrl } = useRuntimeConfig();
  const normalized = normalizeCameraImageOptions(options, topic);
  const compressed = topics.find(
    item => item.name === `${topic}/compressed` && COMPRESSED_IMAGE_TYPES.includes(item.type)
  );
  const fallbackTopic = compressed?.name ?? topic;
  const fallbackType = compressed?.type ?? messageType;
  const client = useRef<CameraImageClient>();
  const latest = useRef({ options, onStatus });
  latest.current = { options, onStatus };
  useEffect(() => {
    if (!viewer.current || !provider.current) return;
    let fallback: string | null = null;
    let status: string | null = null;
    const report = () => latest.current.onStatus(id, [fallback, status].filter(Boolean).join(' ') || null);
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
            ros,
            topic,
            messageType,
            baseUrl: videoStreamBaseUrl,
            source: normalized.imageSource,
            quality: normalized.streamQuality,
            fallbackTopic,
            fallbackType,
          },
          listener,
          reason => {
            fallback = reason;
            report();
          }
        ),
      onStatus: value => {
        status = value;
        report();
      },
    });
    client.current = instance;
    return () => {
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
    fallbackTopic,
    fallbackType,
  ]);
  useEffect(() => {
    client.current?.updateOptions(options);
  }, [options]);
  return null;
});
