import { describe, expect, it } from 'vitest';
import { describeConnectionTarget } from './connections';

describe('describeConnectionTarget', () => {
  it('canonicalizes equivalent hosts and service ports to the same target', () => {
    const first = describeConnectionTarget({
      ros2Option: 'ip',
      ros2Value: ' ROBOT.local ',
      rosbridgePort: '9,090',
      videoStreamPort: '8080',
      meshResourcesPort: '8000',
    });
    const second = describeConnectionTarget({
      ros2Option: 'ip',
      ros2Value: 'robot.local',
      rosbridgePort: '9090',
      videoStreamPort: '8080',
      meshResourcesPort: '8000',
    });

    expect(first.key).toBe(second.key);
    expect(first.storageScope).toBe(second.storageScope);
    expect(first.params.ros2Value).toBe('robot.local');
  });

  it('keeps targets with different service ports independent', () => {
    const first = describeConnectionTarget({ ros2Option: 'ip', ros2Value: 'robot.local', rosbridgePort: '9090' });
    const second = describeConnectionTarget({ ros2Option: 'ip', ros2Value: 'robot.local', rosbridgePort: '9091' });

    expect(first.key).not.toBe(second.key);
    expect(first.storageScope).not.toBe(second.storageScope);
  });

  it('normalizes domain labels and values', () => {
    const target = describeConnectionTarget({ ros2Option: 'domain', ros2Value: ' 7 ' });

    expect(target.label).toBe('Domain 7');
    expect(target.params.ros2Value).toBe(7);
    expect(target.description).toContain('ROS 9090');
  });
});
