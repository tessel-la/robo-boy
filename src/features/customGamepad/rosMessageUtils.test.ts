import { describe, expect, it } from 'vitest';
import {
  buildCameraStreamUrl,
  filterCameraTopics,
  flattenNumericFields,
  getNumericValueAtPath,
  getPlotRange,
  trimPlotSamples,
} from './rosMessageUtils';

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
});
