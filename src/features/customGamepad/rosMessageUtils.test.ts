import { describe, expect, it } from 'vitest';
import {
  buildPoseStampedPayload,
  buildCameraStreamUrl,
  filterCameraTopics,
  flattenNumericFields,
  getNumericValueAtPath,
  getValueAtPath,
  getPlotRange,
  trimPlotSamples,
} from './rosMessageUtils';
import type { GamepadComponentConfig } from './types';

describe('rosMessageUtils', () => {
  it('filters camera topics by ROS 1 and ROS 2 image types', () => {
    expect(filterCameraTopics([
      { name: '/image', type: 'sensor_msgs/msg/Image' },
      { name: '/compressed', type: 'sensor_msgs/CompressedImage' },
      { name: '/cmd_vel', type: 'geometry_msgs/msg/Twist' },
    ])).toEqual([
      { name: '/image', type: 'sensor_msgs/msg/Image' },
      { name: '/compressed', type: 'sensor_msgs/CompressedImage' },
    ]);
  });

  it('builds camera proxy stream URLs with optional dimensions', () => {
    expect(buildCameraStreamUrl({
      topic: '/camera/image_raw',
      streamType: 'mjpeg',
      width: 640,
      height: 480,
    })).toBe('/video_stream/stream?topic=/camera/image_raw&type=mjpeg&width=640&height=480');
  });

  it('flattens nested numeric fields and array indexes', () => {
    const twistFields = flattenNumericFields([
      {
        type: 'geometry_msgs/msg/Twist',
        fieldnames: ['linear', 'angular'],
        fieldtypes: ['geometry_msgs/msg/Vector3', 'geometry_msgs/msg/Vector3'],
        fieldarraylen: [-1, -1],
      },
      {
        type: 'geometry_msgs/msg/Vector3',
        fieldnames: ['x', 'y', 'z'],
        fieldtypes: ['float64', 'float64', 'float64'],
        fieldarraylen: [-1, -1, -1],
      },
    ], 'geometry_msgs/msg/Twist');

    expect(twistFields.map(field => field.path)).toEqual([
      'linear.x',
      'linear.y',
      'linear.z',
      'angular.x',
      'angular.y',
      'angular.z',
    ]);

    const joyFields = flattenNumericFields([
      {
        type: 'sensor_msgs/msg/Joy',
        fieldnames: ['axes'],
        fieldtypes: ['float32'],
        fieldarraylen: [0],
      },
    ], 'sensor_msgs/msg/Joy');

    expect(joyFields.slice(0, 2).map(field => field.path)).toEqual(['axes[0]', 'axes[1]']);
  });

  it('reads numeric values from dot and bracket field paths', () => {
    const message = {
      twist: { twist: { linear: { x: 1.25 } } },
      axes: [0, -0.5],
    };

    expect(getNumericValueAtPath(message, 'twist.twist.linear.x')).toBe(1.25);
    expect(getNumericValueAtPath(message, 'axes[1]')).toBe(-0.5);
    expect(getNumericValueAtPath(message, 'missing.value')).toBeNull();
    expect(getValueAtPath({ status: { flags: [false, true] } }, 'status.flags[1]')).toBe(true);
  });

  it('trims plot samples by window and sample limit', () => {
    const now = 10_000;
    expect(trimPlotSamples([
      { time: 0, value: 0 },
      { time: 8_000, value: 1 },
      { time: 9_000, value: 2 },
      { time: 10_000, value: 3 },
    ], now, 3, 2)).toEqual([
      { time: 9_000, value: 2 },
      { time: 10_000, value: 3 },
    ]);
  });

  it('computes auto and fixed plot ranges', () => {
    expect(getPlotRange([{ time: 0, value: 2 }], true)).toEqual({ min: 1, max: 3 });
    expect(getPlotRange([], false, -5, 5)).toEqual({ min: -5, max: 5 });
  });

  it('builds PoseStamped joystick output in a configured frame', () => {
    const config: GamepadComponentConfig = {
      id: 'pose-stick',
      type: 'joystick',
      position: { x: 0, y: 0, width: 2, height: 2 },
      config: {
        axes: ['position.x', 'position.z'],
        poseStampedFrameId: 'map',
        poseStampedReferenceMode: 'frame',
      },
    };

    expect(buildPoseStampedPayload({
      messageType: 'geometry_msgs/msg/PoseStamped',
      config,
      values: [1.5, -0.25],
      date: new Date(1_000),
    })).toEqual({
      header: {
        stamp: { sec: 1, nanosec: 0 },
        frame_id: 'map',
      },
      pose: {
        position: { x: 1.5, y: 0, z: -0.25 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    });
  });

  it('builds PoseStamped joystick output as an odometry offset', () => {
    const config: GamepadComponentConfig = {
      id: 'pose-stick',
      type: 'joystick',
      position: { x: 0, y: 0, width: 2, height: 2 },
      config: {
        axes: ['position.x', 'position.y'],
        poseStampedReferenceMode: 'odometry',
        poseStampedUseOdometryOrientation: true,
      },
    };

    const message = buildPoseStampedPayload({
      messageType: 'geometry_msgs/PoseStamped',
      config,
      values: [0.5, -1],
      latestOdometry: {
        header: { frame_id: 'odom' },
        pose: {
          pose: {
            position: { x: 10, y: 3, z: 0.25 },
            orientation: { x: 0, y: 0, z: 0.7, w: 0.7 },
          },
        },
      },
      date: new Date(2_500),
    });

    expect(message).toEqual({
      header: {
        stamp: { secs: 2, nsecs: 500_000_000 },
        frame_id: 'odom',
      },
      pose: {
        position: { x: 10.5, y: 2, z: 0.25 },
        orientation: { x: 0, y: 0, z: 0.7, w: 0.7 },
      },
    });
  });
});
