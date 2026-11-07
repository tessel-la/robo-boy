import { useEffect, useState } from 'react';
import type { Ros } from 'roslib';
import '../../components/CameraView.css';
import './RecordedCameraView.css';
import { COMPRESSED_IMAGE_TYPES, isImageType } from '../../utils/images/imageFrames';
import RosCameraImage from '../../components/RosCameraImage';

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
      images.find(topic => topic.name === `${preferred}/compressedDepth` && compressed(topic)) ??
      images.find(topic => topic.name === `${preferred}/compressed` && compressed(topic)) ??
      images.find(topic => topic.name === preferred) ??
      images.find(compressed) ??
      images[0]
    )?.name ?? ''
  );
}

interface Props {
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
export default function RecordedCameraView({ ros, preferredTopic, selectId = 'recorded-camera-topic-select' }: Props) {
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [topic, setTopic] = useState('');

  useEffect(() => {
    let disposed = false;
    ros.getTopics(({ topics: names, types }) => {
      if (disposed) return;
      const images = names
        .map((name, index) => ({ name, type: types[index] ?? '' }))
        .filter(item => isImageType(item.type));
      setTopics(images);
      setTopic(current =>
        images.some(item => item.name === current) ? current : pickRecordedCameraTopic(images, preferredTopic)
      );
    });
    return () => {
      disposed = true;
    };
  }, [ros, preferredTopic]);

  const type = topics.find(item => item.name === topic)?.type;
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
        {type ? (
          <RosCameraImage
            ros={ros}
            topic={topic}
            messageType={type}
            className="recorded-camera-frame"
            label={`Recorded frame from ${topic}`}
            waitingMessage="Waiting for a frame at the playback position…"
          />
        ) : (
          <div className="placeholder">This recording has no camera topics.</div>
        )}
        <span className="recorded-camera-badge">Recording</span>
      </div>
    </div>
  );
}
