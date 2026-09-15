import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';

import * as ROS3D from '../utils/ros3d';
import { CustomTFProvider, normalizeFrameId, type TransformStore } from '../utils/tfUtils';
import { subscribeToTfStream } from '../utils/tfStream';

interface UseTfProviderProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  viewerGeneration: number;
  fixedFrame: string;
  trackTransformUpdates?: boolean;
}

/**
 * Owns the panel-local TF provider while sharing the ROS topic pair with every other 3D panel on
 * the same connection. The provider intentionally starts before the viewer so TF received during
 * a delayed layout/mount is available synchronously when visualizers subscribe.
 */
export function useTfProvider({
  ros,
  isRosConnected,
  ros3dViewer,
  viewerGeneration,
  fixedFrame,
  trackTransformUpdates = false,
}: UseTfProviderProps) {
  const customTFProvider = useRef<CustomTFProvider | null>(null);
  const fixedFrameRef = useRef(fixedFrame);
  fixedFrameRef.current = fixedFrame;
  const [isProviderReady, setIsProviderReady] = useState(false);
  const [transforms, setTransforms] = useState<TransformStore>({});
  const latestTransformsRef = useRef<TransformStore>({});
  const trackTransformUpdatesRef = useRef(trackTransformUpdates);
  trackTransformUpdatesRef.current = trackTransformUpdates;

  useEffect(() => {
    if (!ros || !isRosConnected) {
      customTFProvider.current = null;
      setIsProviderReady(false);
      setTransforms({});
      return;
    }

    const provider = new CustomTFProvider(fixedFrameRef.current, {});
    let active = true;
    latestTransformsRef.current = {};
    setTransforms({});
    customTFProvider.current = provider;

    const unsubscribe = subscribeToTfStream(ros, update => {
      if (!active) return;
      const previousTransforms = latestTransformsRef.current;
      latestTransformsRef.current = update.transforms;
      provider.updateTransforms(update.transforms, update.changedFrames);
      const topologyChanged = [...update.changedFrames].some(frameId => {
        const previous = previousTransforms[frameId];
        const next = update.transforms[frameId];
        return !previous || !next || previous.parentFrame !== next.parentFrame || previous.isStatic !== next.isStatic;
      });
      if (trackTransformUpdatesRef.current || topologyChanged) {
        setTransforms(current => current === update.transforms ? current : update.transforms);
      }
    });

    setIsProviderReady(true);

    return () => {
      active = false;
      unsubscribe();
      provider.dispose();
      if (customTFProvider.current === provider) customTFProvider.current = null;
      latestTransformsRef.current = {};
    };
  }, [isRosConnected, ros]);

  useEffect(() => {
    if (trackTransformUpdates) {
      setTransforms(current => current === latestTransformsRef.current ? current : latestTransformsRef.current);
    }
  }, [trackTransformUpdates]);

  // Fixed-frame state belongs to the provider even before a canvas exists. Each viewer generation
  // is synchronized when it eventually appears or is recreated after a reconnect.
  useEffect(() => {
    const provider = customTFProvider.current;
    if (!isProviderReady || !provider) return;

    const normalizedFixedFrame = normalizeFrameId(fixedFrame);
    if (provider.fixedFrame !== normalizedFixedFrame) {
      provider.updateFixedFrame(normalizedFixedFrame);
    }

    const viewer = ros3dViewer.current;
    if (viewer) {
      viewer.fixedFrame = normalizedFixedFrame;
      viewer.requestRender?.();
    }
  }, [fixedFrame, isProviderReady, ros3dViewer, viewerGeneration]);

  const availableFrames = useMemo(() => {
    const frames = new Set<string>([normalizeFrameId(fixedFrame)]);
    Object.entries(transforms).forEach(([childFrame, entry]) => {
      frames.add(normalizeFrameId(childFrame));
      frames.add(normalizeFrameId(entry.parentFrame));
    });
    return [...frames].filter(Boolean).sort();
  }, [fixedFrame, transforms]);

  return {
    customTFProvider,
    isProviderReady,
    transforms,
    availableFrames,
  };
}
