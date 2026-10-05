import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Resource } from '../../dataExplorer/types';

const inspection = vi.hoisted(() => ({
  snapshot: { mode: 'browser', online: false, current: false, loading: true, truncated: false, resources: [] as unknown[] },
  listeners: new Set<() => void>(),
  released: 0,
  refreshed: 0,
}));

vi.mock('../../dataExplorer/InspectionSession', () => ({
  getInspectionSession: () => ({
    acquire: () => () => {
      inspection.released += 1;
    },
    getSnapshot: () => inspection.snapshot,
    refresh: () => {
      inspection.refreshed += 1;
    },
    subscribe: (listener: () => void) => {
      inspection.listeners.add(listener);
      return () => inspection.listeners.delete(listener);
    },
  }),
}));

const service = vi.hoisted(() => ({ respond: true, calls: [] as string[] }));
vi.mock('roslib', () => ({
  default: {},
  Service: vi.fn(function Service(options: { name: string }) {
    return {
      callService: (_request: unknown, success: (response: unknown) => void) => {
        service.calls.push(options.name);
        if (service.respond) success({ action_servers: [], type: '' });
      },
    };
  }),
}));

import { discoverAllROSResources, resourcesToDiscovery } from './rosDiscovery';

const resource = (kind: Resource['kind'], name: string, types: string[] = []): Resource => ({
  id: `${kind}:${name}`,
  kind,
  name,
  types,
  providers: [],
  consumers: [],
});

const graph = [
  resource('node', '/arm_a/driver'),
  resource('action', '/arm_a/move_to_joints', ['arm_msgs/action/MoveToJoints']),
  resource('action', '/untyped_action'),
  resource('service', '/arm_a/reset', ['std_srvs/srv/Trigger']),
  resource('service', '/arm_a/driver/get_parameters', ['rcl_interfaces/srv/GetParameters']),
  resource('service', '/arm_a/move_to_joints/_action/send_goal', ['arm_msgs/action/MoveToJoints_SendGoal']),
  resource('service', '/rosapi/topics', ['rosapi_msgs/srv/Topics']),
  resource('topic', '/arm_a/joint_states', ['sensor_msgs/msg/JointState']),
  resource('topic', '/parameter_events', ['rcl_interfaces/msg/ParameterEvent']),
  resource('topic', '/ambiguous', ['a/msg/A', 'b/msg/B']),
];

describe('resourcesToDiscovery', () => {
  it('offers typed actions, user services and single-typed user topics', () => {
    expect(resourcesToDiscovery(graph)).toEqual({
      actions: [{ name: '/arm_a/move_to_joints', type: 'arm_msgs/action/MoveToJoints', namespace: 'arm_a' }],
      services: [{ name: '/arm_a/reset', type: 'std_srvs/srv/Trigger' }],
      topics: [{ name: '/arm_a/joint_states', type: 'sensor_msgs/msg/JointState' }],
    });
  });
});

describe('discoverAllROSResources', () => {
  const rosapiRos = () =>
    ({
      on: vi.fn(),
      callOnConnection: vi.fn(),
      getServices: (success: (services: string[]) => void) => (service.respond ? success(['/arm_a/reset']) : undefined),
      getTopics: (success: (result: unknown) => void) =>
        service.respond ? success({ topics: ['/chatter'], types: ['std_msgs/msg/String'] }) : undefined,
      getServiceType: (_name: string, success: (type: string) => void) =>
        service.respond ? success('std_srvs/srv/Trigger') : undefined,
    }) as any;

  beforeEach(() => {
    inspection.snapshot = { mode: 'browser', online: false, current: false, loading: true, truncated: false, resources: [] };
    inspection.listeners.clear();
    inspection.released = 0;
    inspection.refreshed = 0;
    service.respond = true;
    service.calls = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses one inspector graph snapshot and no rosapi calls', async () => {
    const ros = rosapiRos();
    const getServices = vi.spyOn(ros, 'getServices');
    const pending = discoverAllROSResources(ros);
    inspection.snapshot = { mode: 'host', online: true, current: true, loading: false, truncated: false, resources: graph };
    inspection.listeners.forEach(listener => listener());

    const result = await pending;
    expect(inspection.refreshed).toBe(1);
    expect(result.actions.map(action => action.name)).toEqual(['/arm_a/move_to_joints']);
    expect(result.services.map(item => item.name)).toEqual(['/arm_a/reset']);
    expect(getServices).not.toHaveBeenCalled();
    expect(service.calls).toEqual([]);
    expect(inspection.released).toBe(1);
  });

  it('waits past a stale latched graph for the one the inspector confirms', async () => {
    const pending = discoverAllROSResources(rosapiRos());
    // The latched graph predates the action server: delivered first, but not current.
    const stale = graph.filter(item => item.kind !== 'action');
    inspection.snapshot = { mode: 'host', online: true, current: false, loading: false, truncated: false, resources: stale };
    inspection.listeners.forEach(listener => listener());
    await Promise.resolve();
    expect(inspection.released).toBe(0);

    inspection.snapshot = { ...inspection.snapshot, current: true, resources: graph };
    inspection.listeners.forEach(listener => listener());
    const result = await pending;
    expect(result.actions.map(action => action.name)).toEqual(['/arm_a/move_to_joints']);
    expect(service.calls).toEqual([]);
  });

  it('uses a live but unconfirmed graph at the timeout rather than discovering call by call', async () => {
    vi.useFakeTimers();
    const ros = rosapiRos();
    const getServices = vi.spyOn(ros, 'getServices');
    const pending = discoverAllROSResources(ros);
    inspection.snapshot = { mode: 'host', online: true, current: false, loading: false, truncated: false, resources: graph };
    inspection.listeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(6_000);

    const result = await pending;
    expect(result.actions.map(action => action.name)).toEqual(['/arm_a/move_to_joints']);
    expect(getServices).not.toHaveBeenCalled();
  });

  it('falls back at once when the topic list shows no inspector', async () => {
    const pending = discoverAllROSResources(rosapiRos());
    inspection.snapshot = {
      mode: 'browser',
      online: false,
      current: false,
      loading: false,
      truncated: false,
      resources: [resource('topic', '/chatter', ['std_msgs/msg/String'])],
    };
    inspection.listeners.forEach(listener => listener());

    const result = await pending;
    expect(result.services).toEqual([{ name: '/arm_a/reset', type: 'std_srvs/srv/Trigger' }]);
    expect(inspection.released).toBe(1);
  });

  it('skips the inspector for a client that cannot subscribe', async () => {
    const { on: _on, callOnConnection: _call, ...partial } = rosapiRos();
    const result = await discoverAllROSResources(partial as any);
    expect(result.topics).toEqual([{ name: '/chatter', type: 'std_msgs/msg/String' }]);
    expect(inspection.released).toBe(0);
  });

  it('discovers through rosapi when the inspector is listed but never answers', async () => {
    inspection.snapshot = {
      mode: 'browser',
      online: false,
      current: false,
      loading: false,
      truncated: false,
      resources: [resource('topic', '/roboboy/inspection/graph', ['std_msgs/msg/String'])],
    };
    vi.useFakeTimers();
    const pending = discoverAllROSResources(rosapiRos());
    await vi.advanceTimersByTimeAsync(6000);

    const result = await pending;
    expect(result.services).toEqual([{ name: '/arm_a/reset', type: 'std_srvs/srv/Trigger' }]);
    expect(result.topics).toEqual([{ name: '/chatter', type: 'std_msgs/msg/String' }]);
    expect(service.calls).toContain('/rosapi/action_servers');
    expect(inspection.released).toBe(1);
  });

  it('finishes when rosbridge drops rosapi replies instead of waiting forever', async () => {
    vi.useFakeTimers();
    service.respond = false;
    const pending = discoverAllROSResources(rosapiRos());
    await vi.advanceTimersByTimeAsync(6000 + 60_000);

    await expect(pending).resolves.toEqual({ actions: [], services: [], topics: [] });
  });
});
