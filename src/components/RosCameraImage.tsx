import { useEffect, useId, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { subscribeToImages } from '../utils/images/cameraStreams';
import { isImageType } from '../utils/images/imageFrames';
import { DEPTH_DISPLAY_RANGE, type DepthFrame } from '../utils/images/depthFrames';

/** Shared live/replay canvas. Measurements always read metric data, never preview brightness. */
export default function RosCameraImage({
  ros,
  topic,
  messageType,
  className = 'shared-camera-frame',
  label = `ROS camera ${topic}`,
  waitingMessage = 'Waiting for ROS camera frames.',
}: {
  ros: Ros;
  topic: string;
  messageType?: string;
  className?: string;
  label?: string;
  waitingMessage?: string;
}) {
  const measurementId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const depth = useRef<DepthFrame>();
  const pixel = useRef<{ x: number; y: number }>();
  const [isDepth, setIsDepth] = useState(false);
  const [measurement, setMeasurement] = useState('');
  const [error, setError] = useState(waitingMessage);
  const updateMeasurement = () => {
    const frame = depth.current,
      selected = pixel.current;
    const value =
      frame && selected && selected.x < frame.width && selected.y < frame.height
        ? frame.metres[selected.y * frame.width + selected.x]
        : undefined;
    setMeasurement(value === undefined ? '' : value > 0 ? `${value.toFixed(3)} m` : 'No depth');
  };
  // The subscription reads the current pointer without resubscribing on pointer movement.
  const measure = useRef(updateMeasurement);
  measure.current = updateMeasurement;
  useEffect(() => {
    let disposed = false,
      stop: (() => void) | undefined;
    depth.current = undefined;
    pixel.current = undefined;
    setError(waitingMessage);
    setIsDepth(false);
    setMeasurement('');
    const subscribe = (type: string) => {
      if (disposed) return;
      if (!isImageType(type)) {
        setError('Select a ROS Image or CompressedImage topic.');
        return;
      }
      stop = subscribeToImages(ros, topic, type, event => {
        try {
          if (event.error || !event.frame) {
            depth.current = undefined;
            setIsDepth(false);
            setMeasurement('');
            setError(event.error || waitingMessage);
            return;
          }
          const target = canvas.current,
            context = target?.getContext('2d');
          if (!target || !context) throw new Error('Camera canvas is unavailable.');
          const image = event.frame.image;
          if (target.width !== image.width) target.width = image.width;
          if (target.height !== image.height) target.height = image.height;
          if ('close' in image) context.drawImage(image, 0, 0);
          else context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
          depth.current = event.frame.depth;
          setIsDepth(!!depth.current);
          measure.current();
          setError('');
        } catch {
          depth.current = undefined;
          setIsDepth(false);
          setMeasurement('');
          setError('This camera frame could not be drawn.');
        }
      });
    };
    if (messageType) subscribe(messageType);
    else ros.getTopicType(topic, subscribe);
    return () => {
      disposed = true;
      stop?.();
      depth.current = undefined;
    };
  }, [ros, topic, messageType, waitingMessage]);
  const pointToDepth = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const frame = depth.current;
    if (!frame) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
    const x = Math.floor((event.clientX - rect.left - (rect.width - frame.width * scale) / 2) / scale);
    const y = Math.floor((event.clientY - rect.top - (rect.height - frame.height * scale) / 2) / scale);
    pixel.current = x >= 0 && y >= 0 && x < frame.width && y < frame.height ? { x, y } : undefined;
    updateMeasurement();
  };
  return (
    <>
      <canvas
        ref={canvas}
        className={className}
        role="img"
        aria-label={label}
        hidden={!!error}
        tabIndex={isDepth ? 0 : undefined}
        aria-describedby={isDepth ? measurementId : undefined}
        onPointerMove={pointToDepth}
        onPointerDown={pointToDepth}
        onFocus={() => {
          if (!depth.current || pixel.current) return;
          pixel.current = { x: Math.floor(depth.current.width / 2), y: Math.floor(depth.current.height / 2) };
          updateMeasurement();
        }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          const frame = depth.current;
          if (!delta || !frame) return;
          event.preventDefault();
          const current = pixel.current ?? { x: 0, y: 0 };
          pixel.current = {
            x: Math.min(frame.width - 1, Math.max(0, current.x + delta[0])),
            y: Math.min(frame.height - 1, Math.max(0, current.y + delta[1])),
          };
          updateMeasurement();
        }}
        onPointerLeave={() => {
          pixel.current = undefined;
          setMeasurement('');
        }}
      />
      {isDepth && !error && (
        <div className="camera-depth-readout">
          <span>Depth · 0–{DEPTH_DISPLAY_RANGE} m · light → dark</span>
          <output id={measurementId} aria-label="Depth measurement" aria-live="off">
            {measurement || 'Point or use arrow keys to measure'}
          </output>
        </div>
      )}
      {error && (
        <div className="placeholder" role="status">
          {error}
        </div>
      )}
    </>
  );
}
