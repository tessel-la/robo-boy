import { useEffect, useRef, useState } from 'react';
import type { Ros } from 'roslib';
import { subscribeToImages } from '../utils/images/cameraStreams';
import { isImageType } from '../utils/images/imageFrames';
export default function RosCameraImage({ ros, topic }: { ros: Ros; topic: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [error, setError] = useState('Waiting for ROS camera frames.');
  useEffect(() => {
    let disposed = false,
      stop: (() => void) | undefined;
    setError('Waiting for ROS camera frames.');
    ros.getTopicType(topic, type => {
      if (disposed) return;
      if (!isImageType(type)) {
        setError('Select a ROS Image or CompressedImage topic.');
        return;
      }
      stop = subscribeToImages(ros, topic, type, event => {
        if (event.error) {
          setError(event.error);
          return;
        }
        if (!event.frame || !canvas.current) return;
        const target = canvas.current,
          context = target.getContext('2d');
        if (!context) {
          setError('Camera canvas is unavailable.');
          return;
        }
        const image = event.frame.image;
        if (target.width !== image.width) target.width = image.width;
        if (target.height !== image.height) target.height = image.height;
        if ('close' in image) context.drawImage(image, 0, 0);
        else context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        setError('');
      });
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [ros, topic]);
  return (
    <>
      <canvas
        ref={canvas}
        className="shared-camera-frame"
        role="img"
        aria-label={`ROS camera ${topic}`}
        hidden={!!error}
      />
      {error && (
        <div className="placeholder" role="status">
          {error}
        </div>
      )}
    </>
  );
}
