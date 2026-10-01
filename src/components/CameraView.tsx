import React, { useState, useEffect, useRef } from 'react';
import type { Ros } from 'roslib';
import './CameraView.css'; // We'll create this CSS file next
import { useRuntimeConfig } from '../runtime/runtimeConfig';
import { buildCameraStreamUrl } from '../utils/cameraStreamUrl';
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

// Remove hardcoded URL
// const DEFAULT_ROSBRIDGE_URL = 'ws://localhost:9090';

interface CameraViewProps {
  ros: Ros;
  cameraTopic: string; // e.g., /camera/image_raw
  // webVideoServerPort?: number; // Default 8080
  streamType?: string; // Default mjpeg
  streamWidth?: number; // Optional
  streamHeight?: number; // Optional
  // Add new props for topic selection
  availableTopics: string[];
  onTopicChange: (newTopic: string) => void;
  selectId?: string;
  /** Stream preset; uncontrolled (starting at Auto) when no change handler is given. */
  streamQuality?: CameraStreamQuality;
  onStreamQualityChange?: (quality: CameraStreamQuality) => void;
}

const CameraView: React.FC<CameraViewProps> = ({
  ros,
  cameraTopic,
  // webVideoServerPort = 8080, // Port is now handled by proxy
  streamType = 'mjpeg',
  streamWidth,
  streamHeight,
  // Destructure new props
  availableTopics,
  onTopicChange,
  selectId = 'camera-topic-select',
  streamQuality,
  onStreamQualityChange,
}) => {
  const { videoStreamBaseUrl } = useRuntimeConfig();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      if (!cameraTopic) setError('No camera topic selected.');
      else if (!ros?.isConnected) setError('Connecting...');
      else setError('Camera topic is not being published.');
    }
  }, [
    ros,
    ros?.isConnected,
    cameraTopic,
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
  ]);

  return (
    <div className="camera-view">
      {/* Container now needs position relative for absolute positioning of dropdown */}
      <div className="camera-stream-container" ref={setContainer}>
        {/* Add the dropdown selector inside the container */}
        {availableTopics.length > 0 && (
          <div className="camera-topic-selector overlay">
            {/* <label htmlFor="camera-topic-select">Topic:</label> */}
            <select
              id={selectId}
              aria-label="Camera topic"
              value={cameraTopic} // Use current cameraTopic prop
              onChange={e => onTopicChange(e.target.value)} // Use handler prop
            >
              {availableTopics.map(topic => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </select>
            <select
              id={`${selectId}-quality`}
              aria-label="Stream quality"
              title="Auto sizes the stream to this panel. Original sends the camera's full frames, which can need tens of Mbit/s."
              value={quality}
              onChange={e => setQuality(e.target.value as CameraStreamQuality)}
            >
              {CAMERA_STREAM_QUALITIES.map(option => (
                <option key={option} value={option}>
                  {CAMERA_STREAM_PRESETS[option].label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Existing error/image/placeholder rendering */}
        {error ? (
          <div className="error-message">{error}</div>
        ) : streamUrl ? (
          <SafeCameraImage
            src={streamUrl}
            allowedStreamBaseUrl={videoStreamBaseUrl}
            alt={`Stream for ${cameraTopic}`}
            onError={e => {
              console.error('Error loading video stream:', e);
              setError(
                // Update error message to reflect proxy
                `Failed to load stream via proxy (${streamUrl}). Check Caddyfile, web_video_server, topic (${cameraTopic}), and type (${streamType}).`
              );
            }}
          />
        ) : (
          <div className="placeholder">
            {needsSourceSize && isTopicLive ? 'Sizing stream...' : 'Waiting for stream URL...'}
          </div>
        )}
      </div>
      {/* Optional: Keep the title separate or remove it */}
      {/* <h4>Camera Feed ({cameraTopic})</h4> */}
    </div>
  );
};

export default CameraView;
