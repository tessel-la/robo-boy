import { describe, expect, it } from 'vitest';
import { timeSeriesContextTopics } from './timeSeriesContext';

const topics = [
  { name: '/robot/joint_states', type: 'sensor_msgs/msg/JointState' },
  { name: '/other/joint_states', type: 'sensor_msgs/JointState' },
  { name: '/speed', type: 'std_msgs/msg/Float64' },
  { name: '/speed_extra', type: 'std_msgs/msg/Float64' },
];
describe('plot context selection', () => {
  it('uses graph types for a joint-state request without guessing a topic name', () => {
    expect(timeSeriesContextTopics('add a timeserie panel with the joints states', topics)).toEqual(topics.slice(0, 2));
    expect(timeSeriesContextTopics('show joint states', [])).toEqual([]);
  });
  it('prefers explicit topic names and bounds sampling to three sources', () => {
    expect(timeSeriesContextTopics('plot joint states from /other/joint_states', topics)).toEqual([topics[1]]);
    expect(timeSeriesContextTopics('graph /speed.', topics)).toEqual([topics[2]]);
    expect(
      timeSeriesContextTopics('plot /robot/joint_states /other/joint_states /speed /speed_extra', topics)
    ).toHaveLength(3);
  });
  it('does not sample sources for unrelated turns or empty panel creation', () => {
    expect(timeSeriesContextTopics('what publishes /speed?', topics)).toEqual([]);
    expect(timeSeriesContextTopics('add a Time Series panel', topics)).toEqual([]);
  });
});
