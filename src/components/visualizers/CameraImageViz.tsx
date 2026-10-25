import { memo, useEffect, useRef, type RefObject } from 'react';
import type { Ros } from 'roslib';
import type { Viewer } from '../../utils/ros3d';
import type { CustomTFProvider } from '../../utils/tfUtils';
import type { CameraImageOptions } from '../../utils/images/cameraImageOptions';
import { useRuntimeConfig } from '../../runtime/runtimeConfig';
import { normalizeCameraImageOptions } from '../../utils/images/cameraImageOptions';
import { subscribeToProjectionImages } from '../../utils/images/cameraProjectionSource';
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
}: {
  ros: Ros;
  viewer: RefObject<Viewer | null>;
  provider: RefObject<CustomTFProvider | null>;
  topic: string;
  messageType: string;
  options: CameraImageOptions;
  id: string;
  onStatus: (id: string, status: string | null) => void;
}) {
  const { videoStreamBaseUrl } = useRuntimeConfig();
  const normalized = normalizeCameraImageOptions(options, topic);
  const client = useRef<CameraImageClient>();
  const latest = useRef({ options, onStatus });
  latest.current = { options, onStatus };
  useEffect(() => {
    if (!viewer.current || !provider.current) return;
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
          },
          listener
        ),
      onStatus: value => latest.current.onStatus(id, value),
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
  ]);
  useEffect(() => {
    client.current?.updateOptions(options);
  }, [options]);
  return null;
});
