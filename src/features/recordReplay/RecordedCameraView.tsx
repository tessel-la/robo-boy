import { useEffect, useRef, useState } from 'react';
import ROSLIB, { type Ros } from 'roslib';
import { useCameraPresentation } from '../camera/presentation';
import '../../components/CameraView.css';
import './RecordedCameraView.css';
import {
  COMPRESSED_IMAGE_TYPES,
  compressedImageBlob,
  isImageType,
  rawImageToRgba,
  type CompressedImage,
  type RawImage,
} from './imageFrames';

interface TopicInfo {
  name: string;
  type: string;
}

/**
 * The recorded topic that stands in for a camera panel's live topic: its compressed twin when the
 * recording has one (a fraction of the data, decoded natively), else the topic itself, else any camera.
 */
export function pickRecordedCameraTopic(topics: TopicInfo[], preferred: string): string {
  const images = topics.filter(topic => isImageType(topic.type));
  const compressed = (topic: TopicInfo) => COMPRESSED_IMAGE_TYPES.includes(topic.type);
  return (
    (
      images.find(topic => topic.name === `${preferred}/compressed` && compressed(topic)) ??
      images.find(topic => topic.name === preferred) ??
      images.find(compressed) ??
      images[0]
    )?.name ?? ''
  );
}

interface Props {
  panelId?: string;
  storageScope?: string;
  /** The replay source: the recording's messages, read through a ROS-shaped adapter. */
  ros: Ros;
  /** The panel's live camera topic, matched against the recording. */
  preferredTopic: string;
  selectId?: string;
}

/**
 * A camera panel during replay. Live, the image comes from web_video_server on the robot, which knows
 * nothing about the recording; here the recorded Image or CompressedImage messages are drawn instead,
 * following the playback cursor like every other replayed panel.
 */
export default function RecordedCameraView({
  ros,
  preferredTopic,
  panelId,
  storageScope,
  selectId = 'recorded-camera-topic-select',
}: Props) {
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [topic, setTopic] = useState('');
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const revision = useRef(0);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    ros.getTopics(({ topics: names, types }) => {
      const images = names
        .map((name, index) => ({ name, type: types[index] ?? '' }))
        .filter(item => isImageType(item.type));
      setTopics(images);
      setTopic(current =>
        images.some(item => item.name === current) ? current : pickRecordedCameraTopic(images, preferredTopic)
      );
    });
  }, [ros, preferredTopic]);

  useEffect(() => {
    const type = topics.find(item => item.name === topic)?.type;
    if (!type) return;
    setShowing(false);
    setError('');
    const compressed = COMPRESSED_IMAGE_TYPES.includes(type);
    let latest: unknown;
    let pending = 0;
    let generation = 0;
    let disposed = false;
    // Only the newest frame is drawn, once per display frame: playback at 8× never queues images.
    const draw = async () => {
      pending = 0;
      const message = latest;
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (!message || !target || !context) return;
      const token = ++generation;
      try {
        const image = compressed
          ? await createImageBitmap(compressedImageBlob(message as CompressedImage))
          : rawImageToRgba(message as RawImage);
        if (disposed || token !== generation) {
          if ('close' in image) image.close();
          return;
        }
        if (target.width !== image.width) target.width = image.width;
        if (target.height !== image.height) target.height = image.height;
        if ('close' in image) {
          context.drawImage(image, 0, 0);
          image.close();
        } else
          context.putImageData(
            new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height),
            0,
            0
          );
        revision.current++;
        setShowing(true);
        setError('');
      } catch (reason) {
        if (!disposed)
          setError(
            reason instanceof Error && reason.message.startsWith('Replay')
              ? reason.message
              : 'This recorded frame could not be decoded.'
          );
      }
    };
    const subscription = new ROSLIB.Topic({ ros, name: topic, messageType: type });
    subscription.subscribe(message => {
      latest = message;
      if (!pending) pending = requestAnimationFrame(() => void draw());
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(pending);
      subscription.unsubscribe();
    };
  }, [ros, topic, topics, retryKey]);

  const message =
    error ||
    (!topics.length
      ? 'This recording has no camera topics.'
      : !showing
        ? 'Waiting for a frame at the playback position…'
        : '');
  useCameraPresentation(panelId, storageScope, {
    snapshot: () => ({
      topic,
      topics: topics.map(item => item.name),
      source: showing && !error ? canvas.current : null,
      revision: revision.current,
      message,
      recorded: true,
    }),
    selectTopic: value => {
      if (topics.some(item => item.name === value)) setTopic(value);
    },
    retry: () => setRetryKey(key => key + 1),
    setPresented: () => {}, // The same decoded canvas serves desktop and XR; no second draw loop.
  });
  return (
    <div className="camera-view recorded-camera">
      <div className="camera-stream-container">
        {topics.length > 0 && (
          <div className="camera-topic-selector overlay">
            <select
              id={selectId}
              aria-label="Recorded camera topic"
              value={topic}
              onChange={event => setTopic(event.target.value)}
            >
              {topics.map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <canvas
          ref={canvas}
          className="recorded-camera-frame"
          role="img"
          aria-label={`Recorded frame from ${topic}`}
          hidden={!showing || Boolean(error)}
        />
        {message && <div className={error ? 'error-message' : 'placeholder'}>{message}</div>}
        <span className="recorded-camera-badge">Recording</span>
      </div>
    </div>
  );
}
