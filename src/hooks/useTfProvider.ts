import { useEffect, useMemo, useRef, useState } from 'react';
import type { Ros } from 'roslib';

import * as ROS3D from '../utils/ros3d';
import { CustomTFProvider, getTfFrameNames, normalizeFrameId, resolveFixedFrame, type TransformStore } from '../utils/tfUtils';
import { subscribeToTfStream } from '../utils/tfStream';

interface UseTfProviderProps {
  ros: Ros | null;
  isRosConnected: boolean;
  ros3dViewer: React.RefObject<ROS3D.Viewer | null>;
  viewerGeneration: number;
  /** The frame the user asked for, or '' to let the provider pick one from the live tree. */
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
  fixedFrame: preferredFixedFrame,
  trackTransformUpdates = false,
}: UseTfProviderProps) {
  const customTFProvider = useRef<CustomTFProvider | null>(null);
  const [isProviderReady, setIsProviderReady] = useState(false);
  const [transforms, setTransforms] = useState<TransformStore>({});
  // Resolved on every snapshot but only changes value when the tree gains or loses the frames it
  // depends on, so the viewer/provider sync below stays quiet during pose-only traffic.
  const fixedFrame = useMemo(
    () => resolveFixedFrame(preferredFixedFrame, transforms),
    [preferredFixedFrame, transforms]
  );
  const fixedFrameRef = useRef(fixedFrame);
  fixedFrameRef.current = fixedFrame;
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

  // Only frames the tree actually contains, so no phantom entry shows up before TF arrives.
  // Content-stable: `transforms` is replaced on every tracked TF message, but consumers key
  // scene rebuilds on this list, so its identity only changes when the set of frames does.
  const availableFramesRef = useRef<string[]>([]);
  const availableFrames = useMemo(() => {
    const next = getTfFrameNames(transforms);
    const previous = availableFramesRef.current;
    if (previous.length === next.length && previous.every((frame, index) => frame === next[index])) {
      return previous;
    }
    availableFramesRef.current = next;
    return next;
  }, [transforms]);

  return {
    customTFProvider,
    isProviderReady,
    transforms,
    availableFrames,
    fixedFrame,
  };
}
