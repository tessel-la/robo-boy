import { useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import SafeCameraImage from './SafeCameraImage';
import { subscribeToMjpeg } from '../utils/images/mjpegStreams';

/** MJPEG frames shared with other trusted camera consumers; native playback remains a compatibility fallback. */
export default function SharedCameraImage({
  ros,
  src,
  baseUrl,
  alt,
  onError,
}: {
  ros: Ros;
  src: string;
  baseUrl: string;
  alt: string;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [native, setNative] = useState(false);
  const [showing, setShowing] = useState(false);
  const latestError = useRef(onError);
  latestError.current = onError;
  useEffect(() => {
    setNative(false);
    setShowing(false);
  }, [src, ros, baseUrl]);
  useEffect(() => {
    if (native) return;
    if (typeof createImageBitmap !== 'function' || typeof ReadableStream === 'undefined') {
      setNative(true);
      return;
    }
    return subscribeToMjpeg(ros, src, baseUrl, event => {
      if (event.error) {
        setNative(true);
        return;
      }
      if (!event.frame) return;
      try {
        const target = canvas.current;
        const context = target?.getContext('2d');
        if (!target || !context) throw new Error('Camera canvas is unavailable.');
        const image = event.frame.image;
        if (target.width !== image.width) target.width = image.width;
        if (target.height !== image.height) target.height = image.height;
        if ('close' in image) context.drawImage(image, 0, 0);
        else context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        setShowing(true);
      } catch {
        setNative(true);
      }
    });
  }, [ros, src, baseUrl, native]);
  if (native)
    return <SafeCameraImage src={src} allowedStreamBaseUrl={baseUrl} alt={alt} onError={() => latestError.current()} />;
  return (
    <>
      <canvas ref={canvas} role="img" aria-label={alt} className="shared-camera-frame" hidden={!showing} />
      {!showing && <div className="placeholder">Waiting for camera frames...</div>}
    </>
  );
}
