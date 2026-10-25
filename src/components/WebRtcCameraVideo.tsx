import { useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { subscribeToWebRtcVideo } from '../utils/images/webrtcStreams';
export default function WebRtcCameraVideo({ ros, url }: { ros: Ros; url: string }) {
  const video = useRef<HTMLVideoElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    setError('');
    if (!url) {
      setError('Choose a WebRTC stream or enter its WHEP URL.');
      return;
    }
    let stop: (() => void) | undefined;
    try {
      stop = subscribeToWebRtcVideo(ros, url, event => {
        setError(event.error ?? '');
        if (!video.current) return;
        video.current.srcObject = event.stream;
        if (event.stream)
          void video.current.play().catch(() => setError('Video playback was blocked. Select Play to start it.'));
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'WebRTC is unavailable.');
    }
    return () => {
      stop?.();
      if (video.current) video.current.srcObject = null;
    };
  }, [ros, url]);
  return (
    <>
      <video ref={video} muted autoPlay playsInline controls aria-label="WebRTC camera video" />
      {error && (
        <div className="error-message" role="status">
          {error}
        </div>
      )}
    </>
  );
}
