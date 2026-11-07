import { describe, expect, it } from 'vitest';
import { validatePayload } from './payloadValidation';
const schema = { defaults: {}, fields: [{ name: 'trajectory', rosType: 'trajectory_msgs/msg/JointTrajectory', arrayLen: -1, subfields: [
  { name: 'joint_names', rosType: 'string', arrayLen: 0 },
  { name: 'points', rosType: 'trajectory_msgs/msg/JointTrajectoryPoint', arrayLen: 0, subfields: [{ name: 'positions', rosType: 'float64', arrayLen: 0 }] },
] }] };
describe('ROS payload validation', () => {
  it('accepts nested ROS arrays and rejects guessed fields or incompatible values', () => {
    expect(validatePayload({ trajectory: { joint_names: ['joint1'], points: [{ positions: [0.5] }] } }, schema)).toEqual([]);
    expect(validatePayload({ trajectory: { joint_names: 'joint1', points: [{ position: [0.5] }] } }, schema)).toEqual(['trajectory.joint_names must be an array.', 'Unknown ROS field trajectory.points[0].position.']);
    expect(validatePayload({ trajectory: { points: [{ positions: [Infinity] }] } }, schema)[0]).toContain('finite float64');
  });
});
