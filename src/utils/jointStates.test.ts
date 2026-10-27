import { describe, expect, it } from 'vitest';
import {
  parseJointState,
  parseJointLimits,
  clampOverlayFrame,
  normalizeJointStateOptions,
  jointDescriptionTopic,
} from './jointStates';
import { getTopicsForVisualizationType } from './visualizationTopics';

describe('joint telemetry contracts', () => {
  it('maps names to partial values and treats nonfinite readings as unavailable', () => {
    expect(
      parseJointState(
        { name: ['slide', 'wheel'], position: [0.2, NaN], velocity: [], effort: new Float64Array([2, 3]) },
        10
      )
    ).toEqual([
      { name: 'slide', position: 0.2, velocity: undefined, effort: 2, receivedAt: 10 },
      { name: 'wheel', position: undefined, velocity: undefined, effort: 3, receivedAt: 10 },
    ]);
    for (const message of [null, { name: ['a', 'a'] }, { name: ['a'], position: [1, 2] }, { name: [5] }])
      expect(() => parseJointState(message, 0)).toThrow();
  });
  it('uses position limits only for bounded joint types and reads velocity/effort maxima', () => {
    const limits = parseJointLimits(`<robot name="r">
      <joint name="slide" type="prismatic"><limit lower="-0.1" upper="0.4" velocity="2" effort="20" /></joint>
      <joint name="wheel" type="continuous"><limit lower="-3" upper="3" velocity="5" effort="10" /></joint>
      <joint name="__proto__" type="revolute"><limit lower="-1" upper="1" /></joint>
    </robot>`);
    expect(limits.slide).toEqual({ type: 'prismatic', lower: -0.1, upper: 0.4, velocity: 2, effort: 20 });
    expect(limits.wheel).toMatchObject({ type: 'continuous', lower: undefined, upper: undefined });
    expect(limits.__proto__.lower).toBe(-1);
    for (const xml of [
      '<robot>',
      '<other/>',
      '<!DOCTYPE robot><robot/>',
      '<robot><joint name="a" type="revolute"><limit lower="2" upper="1" /></joint></robot>',
      '<robot><joint name="a" type="revolute"><limit velocity="-1" /></joint></robot>',
    ])
      expect(() => parseJointLimits(xml)).toThrow();
  });
  it('clamps corrupt/offscreen placement to the panel including small mobile panels', () => {
    expect(clampOverlayFrame(undefined, 800, 600)).toEqual({ left: 468, top: 12, width: 320, height: 300 });
    expect(clampOverlayFrame({ left: 999, top: -100, width: 1000, height: 900 }, 200, 250)).toEqual({
      left: 8,
      top: 8,
      width: 184,
      height: 234,
    });
    expect(clampOverlayFrame({ left: NaN, top: 2, width: 500, height: 500 }, 800, 600).left).toBe(468);
    expect(normalizeJointStateOptions({ backgroundOpacity: NaN }).backgroundOpacity).toBe(0.9);
  });
  it('discovers ROS spellings and selects limits from the same namespace before a global description', () => {
    const topics = [
      { name: '/r/joints', type: 'sensor_msgs/msg/JointState' },
      { name: '/joints', type: 'sensor_msgs/JointState' },
      { name: '/r/robot_description', type: 'std_msgs/msg/String' },
      { name: '/other/robot_description', type: 'std_msgs/String' },
    ];
    expect(getTopicsForVisualizationType('jointstate', topics)).toHaveLength(2);
    expect(jointDescriptionTopic('/r/joints', topics)).toBe('/r/robot_description');
    expect(jointDescriptionTopic('/joints', topics)).toBe('');
  });
});
