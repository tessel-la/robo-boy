import type { RosTopicInfo } from './urdfTopics';
import { CLOUDINI_TYPE, isCompressedPointCloud } from './cloudini/cloudiniMessage';

/** Saved raw topic names remain stable. Prefer the robot's derived stream only when discovery advertises it. */
export function pointCloudSource(topic: string, topics: readonly RosTopicInfo[]) {
  const selected = topics.find(item => item.name === topic);
  if (selected && isCompressedPointCloud(selected.type)) return { topic, messageType: selected.type };
  const compressed = `/roboboy/cloudini${topic}`;
  if (topics.some(item => item.name === compressed && isCompressedPointCloud(item.type)))
    return { topic: compressed, messageType: CLOUDINI_TYPE };
  return { topic, messageType: selected?.type ?? 'sensor_msgs/PointCloud2' };
}
