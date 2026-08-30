import { describe, expect, it } from 'vitest';
import { getPreferredUrdfTopic, getUrdfTopics, isRobotDescriptionTopicName } from './urdfTopics';

describe('URDF topic discovery', () => {
  const topics = [
    { name: '/behavior/status', type: 'std_msgs/msg/String' },
    { name: '/robot_description_updates', type: 'std_msgs/msg/String' },
    { name: '/robot_description', type: 'std_msgs/msg/String' },
    { name: '/robot_2/robot_description', type: 'std_msgs/String' },
    { name: '/robot_3/robot_description', type: 'example_msgs/Description' },
  ];

  it('recognizes the standard topic name with or without a namespace', () => {
    expect(isRobotDescriptionTopicName('/robot_description')).toBe(true);
    expect(isRobotDescriptionTopicName('robot_description')).toBe(true);
    expect(isRobotDescriptionTopicName('/robot_2/robot_description')).toBe(true);
    expect(isRobotDescriptionTopicName('/behavior/robot_description_status')).toBe(false);
  });

  it('requires both a robot_description name and a ROS String type', () => {
    expect(getUrdfTopics(topics)).toEqual([
      { name: '/robot_description', type: 'std_msgs/msg/String' },
      { name: '/robot_2/robot_description', type: 'std_msgs/String' },
    ]);
  });

  it('prefers the conventional root topic over namespaced candidates', () => {
    expect(getPreferredUrdfTopic(getUrdfTopics(topics))?.name).toBe('/robot_description');
  });
});
