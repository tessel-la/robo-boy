export interface RosTopicInfo {
  name: string;
  type: string;
}

const URDF_MESSAGE_TYPES = new Set(['std_msgs/String', 'std_msgs/msg/String']);

export const isRobotDescriptionTopicName = (topicName: string): boolean => {
  const segments = topicName.split('/').filter(Boolean);
  return segments[segments.length - 1] === 'robot_description';
};

export const isUrdfTopic = (topic: RosTopicInfo): boolean =>
  URDF_MESSAGE_TYPES.has(topic.type) && isRobotDescriptionTopicName(topic.name);

export const getUrdfTopics = (topics: RosTopicInfo[]): RosTopicInfo[] => topics.filter(isUrdfTopic);

export const getPreferredUrdfTopic = (topics: RosTopicInfo[]): RosTopicInfo | undefined =>
  topics.find(topic => topic.name === '/robot_description' || topic.name === 'robot_description') ?? topics[0];
