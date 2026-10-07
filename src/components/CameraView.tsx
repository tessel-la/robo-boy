import React, { useState, useEffect, useRef } from 'react';
import { FiRefreshCw } from 'react-icons/fi';
import type { Ros } from 'roslib';
import './CameraView.css';
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { buildCameraStreamUrl } from '../utils/cameraStreamUrl';
import { createUuid } from '../utils/uuid';
import {
  CAMERA_STREAM_PRESETS,
  CAMERA_STREAM_QUALITIES,
  DEFAULT_CAMERA_STREAM_QUALITY,
  probeCameraSourceSize,
  resolveCameraStreamParams,
  type CameraStreamQuality,
  type FrameSize,
} from '../utils/cameraStreamQuality';
import SafeCameraImage from './SafeCameraImage';

const PANEL_RESIZE_SETTLE_MS = 300;

/** The stream container's size once it stops changing, so dragging a divider restarts nothing. */
function useSettledSize(element: HTMLElement | null): FrameSize | null {
  const [size, setSize] = useState<FrameSize | null>(null);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      const { width, height } = entry.contentRect;
      timer = setTimeout(() => {
        setSize(previous => (previous?.width === width && previous?.height === height ? previous : { width, height }));
      }, PANEL_RESIZE_SETTLE_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [element]);
  return size;
}

interface CameraViewProps {
  ros: Ros;
  cameraTopic: string; // e.g., /camera/image_raw
  streamType?: string; // Default mjpeg
  streamWidth?: number; // Optional
  streamHeight?: number; // Optional
  availableTopics: string[];
  onTopicChange: (newTopic: string) => void;
  selectId?: string;
  /** Stream preset; uncontrolled (starting at Auto) when no change handler is given. */
  streamQuality?: CameraStreamQuality;
  onStreamQualityChange?: (quality: CameraStreamQuality) => void;
  onRefreshTopics?: () => Promise<boolean>;
  refreshingTopics?: boolean;
  topicsError?: string;
}

const CameraView: React.FC<CameraViewProps> = ({
  ros,
  cameraTopic,
  streamType = 'mjpeg',
  streamWidth,
  streamHeight,
  availableTopics,
  onTopicChange,
  selectId = 'camera-topic-select',
  streamQuality,
  onStreamQualityChange,
  onRefreshTopics,
  refreshingTopics = false,
  topicsError = '',
}) => {
  const { videoStreamBaseUrl } = useRuntimeConfig();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamRevision, setStreamRevision] = useState<string>();
  const refreshGeneration = useRef(0);
  const [localQuality, setLocalQuality] = useState<CameraStreamQuality>(streamQuality ?? DEFAULT_CAMERA_STREAM_QUALITY);
  const quality = onStreamQualityChange ? (streamQuality ?? DEFAULT_CAMERA_STREAM_QUALITY) : localQuality;
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const panelSize = useSettledSize(container);
  // undefined while the camera's frame size is being probed; null when it could not be read.
  const [source, setSource] = useState<{ key: string; size: FrameSize | null } | undefined>();
  const sourceKey = `${videoStreamBaseUrl}\n${cameraTopic}`;
  const isTopicLive = Boolean(ros && ros.isConnected && cameraTopic && availableTopics.includes(cameraTopic));
  const explicitSize = Boolean(streamWidth || streamHeight);
  const needsSourceSize = !explicitSize && Boolean(CAMERA_STREAM_PRESETS[quality].maxWidth);
  const sourceSize = source?.key === sourceKey ? source.size : undefined;
  const latestSourceKey = useRef(sourceKey);
  latestSourceKey.current = sourceKey;
  useEffect(
    () => () => {
      ++refreshGeneration.current;
    },
    [ros, sourceKey]
  );

  const refreshCamera = async () => {
    const generation = ++refreshGeneration.current;
    const refreshed = onRefreshTopics ? await onRefreshTopics() : true;
    if (refreshed && generation === refreshGeneration.current) setStreamRevision(createUuid());
  };

  useEffect(() => {
    if (!isTopicLive || !needsSourceSize || sourceSize !== undefined) return;
    const key = sourceKey;
    void probeCameraSourceSize(videoStreamBaseUrl, cameraTopic).then(size => {
      if (latestSourceKey.current === key) setSource({ key, size });
    });
  }, [isTopicLive, needsSourceSize, sourceSize, sourceKey, videoStreamBaseUrl, cameraTopic]);

  const setQuality = (next: CameraStreamQuality) => {
    if (onStreamQualityChange) onStreamQualityChange(next);
    else setLocalQuality(next);
  };

  useEffect(() => {
    console.log('[CameraView useEffect] Checking dependencies:', {
      rosExists: !!ros,
      isConnected: ros?.isConnected,
      cameraTopic: cameraTopic,
    });

    // Pointing an <img> at a topic web_video_server is not publishing returns an empty
    // multipart response, which WebKitGTK 2.52.6 dereferences null on: it takes the whole
    // renderer down, so the window freezes on its last frame. A saved layout outlives the
    // topics it was built against, so availability is checked rather than assumed.
    if (isTopicLive) {
      const awaitingPanelSize =
        !explicitSize && CAMERA_STREAM_PRESETS[quality].fitPanel && typeof ResizeObserver !== 'undefined' && !panelSize;
      if ((needsSourceSize && sourceSize === undefined) || awaitingPanelSize) {
        // Without the camera's aspect ratio a scaled stream would come out stretched.
        setStreamUrl(null);
        setError(null);
        return;
      }
      try {
        const params = explicitSize
          ? { width: streamWidth, height: streamHeight, quality: CAMERA_STREAM_PRESETS[quality].jpegQuality }
          : resolveCameraStreamParams({
              quality,
              source: sourceSize ?? null,
              panel: panelSize,
              devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
            });
        const url = buildCameraStreamUrl({
          topic: cameraTopic,
          streamType,
          ...params,
          baseUrl: videoStreamBaseUrl,
          refresh: streamRevision,
        });
        setStreamUrl(url);
        setError(null);
        console.log(`[CameraView] Relative stream URL set to: ${url}`);
      } catch (e) {
        console.error('[CameraView] Error constructing stream URL:', e);
        setError('Failed to construct stream URL.');
        setStreamUrl(null);
      }
    } else {
      setStreamUrl(null);
      if (!cameraTopic)
        setError(
          availableTopics.length
            ? 'No camera topic selected.'
            : 'No camera topics found. Start a camera publisher, then refresh.'
        );
      else if (!ros?.isConnected) setError('Connecting...');
      else setError('Camera topic is not being published.');
    }
  }, [
    ros,
    ros?.isConnected,
    cameraTopic,
    availableTopics.length,
    isTopicLive,
    streamType,
    streamWidth,
    streamHeight,
    explicitSize,
    needsSourceSize,
    sourceSize,
    panelSize,
    quality,
    videoStreamBaseUrl,
    streamRevision,
  ]);

  return (
    <div className="camera-view">
      <div className="camera-toolbar" aria-label="Camera controls">
        <div className="camera-field camera-topic-field">
          <label htmlFor={selectId}>Topic</label>
          <select
            id={selectId}
            aria-label="Camera topic"
            value={cameraTopic}
            disabled={!availableTopics.length}
            title={cameraTopic || 'Choose a camera topic'}
            onChange={event => onTopicChange(event.target.value)}
          >
            {!availableTopics.includes(cameraTopic) && (
              <option value={cameraTopic} disabled>
                {cameraTopic ? `${cameraTopic} (unavailable)` : 'No topic selected'}
              </option>
            )}
            {availableTopics.map(topic => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </select>
        </div>
        <div className="camera-field camera-quality-field">
          <label htmlFor={`${selectId}-quality`}>Quality</label>
          <select
            id={`${selectId}-quality`}
            aria-label="Stream quality"
            title="Auto fits this panel. Original uses full-size frames and more bandwidth."
            value={quality}
            onChange={event => setQuality(event.target.value as CameraStreamQuality)}
          >
            {CAMERA_STREAM_QUALITIES.map(option => (
              <option key={option} value={option}>
                {CAMERA_STREAM_PRESETS[option].label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="camera-refresh"
          aria-label="Refresh camera topics and stream"
          title="Refresh camera topics and retry the stream"
          disabled={!ros?.isConnected || refreshingTopics}
          aria-busy={refreshingTopics}
          onClick={() => void refreshCamera()}
        >
          <FiRefreshCw aria-hidden="true" />
          <span>{refreshingTopics ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>
      {topicsError && (
        <p className="camera-discovery-error" role="alert">
          {topicsError}
        </p>
      )}
      <div className="camera-stream-container" ref={setContainer}>
        {error ? (
          <div className="error-message">{error}</div>
        ) : streamUrl && isTopicLive ? (
          <SafeCameraImage
            src={streamUrl}
            allowedStreamBaseUrl={videoStreamBaseUrl}
            alt={`Stream for ${cameraTopic}`}
            onError={e => {
              console.error('Error loading video stream:', e);
              setError(
                // Update error message to reflect proxy
                'Could not load this camera stream. Refresh to retry.'
              );
            }}
          />
        ) : (
          <div className="placeholder">
            {needsSourceSize && isTopicLive ? 'Sizing stream...' : 'Waiting for stream URL...'}
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraView;
