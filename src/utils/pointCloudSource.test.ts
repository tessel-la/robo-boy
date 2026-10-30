import { describe, expect, it } from 'vitest';
import { pointCloudSource } from './pointCloudSource';
import { getTopicsForVisualizationType } from './visualizationTopics';

describe('point-cloud transport selection', () => {
  const raw = { name: '/robot/points', type: 'sensor_msgs/msg/PointCloud2' };
  const compressed = {
    name: '/roboboy/cloudini/robot/points',
    type: 'point_cloud_interfaces/msg/CompressedPointCloud2',
  };
  it('preserves raw topics on older stacks and recordings', () => {
    expect(pointCloudSource(raw.name, [raw])).toEqual({ topic: raw.name, messageType: raw.type });
    expect(pointCloudSource(raw.name, [])).toEqual({ topic: raw.name, messageType: 'sensor_msgs/PointCloud2' });
  });
  it('prefers only the matching derived compressed topic, without changing the saved raw name', () => {
    expect(pointCloudSource(raw.name, [raw, compressed])).toEqual({
      topic: compressed.name,
      messageType: compressed.type,
    });
    expect(pointCloudSource('/other', [compressed]).topic).toBe('/other');
    expect(pointCloudSource(raw.name, [{ ...compressed, type: 'std_msgs/String' }]).topic).toBe(raw.name);
  });
  it('accepts explicit compressed topics and both ROS spellings in discovery', () => {
    expect(pointCloudSource(compressed.name, [compressed]).topic).toBe(compressed.name);
    expect(
      getTopicsForVisualizationType('pointcloud', [
        raw,
        compressed,
        { name: '/other', type: 'point_cloud_interfaces/CompressedPointCloud2' },
        { name: '/unrelated', type: 'std_msgs/String' },
      ])
    ).toHaveLength(3);
  });
});
