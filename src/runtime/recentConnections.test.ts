import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRecentConnections,
  MAX_RECENT_CONNECTIONS,
  RECENT_CONNECTIONS_STORAGE_KEY,
  removeRecentConnection,
  saveRecentConnection,
} from './recentConnections';

describe('recentConnections', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores successful host connections with normalized hostnames', () => {
    const recent = saveRecentConnection({ ros2Option: 'ip', ros2Value: 'http://robot.tailnet.ts.net:1234/path' }, 10);

    expect(recent).toEqual([
      {
        host: 'robot.tailnet.ts.net',
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        lastConnectedAt: 10,
      },
    ]);
    expect(loadRecentConnections()).toEqual(recent);
  });

  it('stores repaired comma-separated IPv4 hostnames', () => {
    const recent = saveRecentConnection({ ros2Option: 'ip', ros2Value: '192,168,1,20' }, 10);

    expect(recent).toEqual([
      {
        host: '192.168.1.20',
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        lastConnectedAt: 10,
      },
    ]);
  });

  it('stores custom service ports with recent hosts', () => {
    const recent = saveRecentConnection(
      {
        ros2Option: 'ip',
        ros2Value: 'robot.tailnet.ts.net',
        rosbridgePort: '19,090',
        videoStreamPort: '18,080',
        meshResourcesPort: '18,000',
      },
      10
    );

    expect(recent).toEqual([
      {
        host: 'robot.tailnet.ts.net',
        rosbridgePort: '19090',
        videoStreamPort: '18080',
        meshResourcesPort: '18000',
        lastConnectedAt: 10,
      },
    ]);
  });

  it('does not store domain-id connections as machines', () => {
    saveRecentConnection({ ros2Option: 'domain', ros2Value: 14 }, 10);

    expect(loadRecentConnections()).toEqual([]);
  });

  it('deduplicates hosts case-insensitively and keeps the latest first', () => {
    saveRecentConnection({ ros2Option: 'ip', ros2Value: 'Robot.Local' }, 10);
    saveRecentConnection({ ros2Option: 'ip', ros2Value: 'robot.local' }, 20);
    saveRecentConnection({ ros2Option: 'ip', ros2Value: 'camera.local' }, 15);

    expect(loadRecentConnections()).toEqual([
      {
        host: 'robot.local',
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        lastConnectedAt: 20,
      },
      {
        host: 'camera.local',
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        lastConnectedAt: 15,
      },
    ]);
  });

  it('caps the list to the most recent hosts', () => {
    for (let index = 0; index < MAX_RECENT_CONNECTIONS + 2; index += 1) {
      saveRecentConnection({ ros2Option: 'ip', ros2Value: `robot-${index}.local` }, index);
    }

    expect(loadRecentConnections().map(connection => connection.host)).toEqual([
      'robot-6.local',
      'robot-5.local',
      'robot-4.local',
      'robot-3.local',
      'robot-2.local',
    ]);
  });

  it('removes a stored host', () => {
    localStorage.setItem(
      RECENT_CONNECTIONS_STORAGE_KEY,
      JSON.stringify([
        { host: 'robot.local', lastConnectedAt: 20 },
        { host: 'camera.local', lastConnectedAt: 15 },
      ])
    );

    expect(removeRecentConnection('robot.local')).toEqual([
      {
        host: 'camera.local',
        rosbridgePort: '9090',
        videoStreamPort: '8080',
        meshResourcesPort: '8000',
        lastConnectedAt: 15,
      },
    ]);
  });
});
