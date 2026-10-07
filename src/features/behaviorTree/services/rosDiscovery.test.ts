import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockRoslib = vi.hoisted(() => ({
  response: null as unknown,
  calls: [] as Array<{ options: unknown; request: unknown }>,
}));

vi.mock('roslib', () => ({
  default: {},
  Service: vi.fn(function Service(options: unknown) {
    return {
      callService: vi.fn((request: unknown, success: (response: unknown) => void) => {
        mockRoslib.calls.push({ options, request });
        success(mockRoslib.response);
      }),
    };
  }),
}));

import { fetchActionGoalDetails, fetchServiceRequestSchema } from './rosDiscovery';

describe('fetchActionGoalDetails', () => {
  beforeEach(() => {
    mockRoslib.calls = [];
    mockRoslib.response = null;
  });

  it('keeps nested message-array element fields for trajectory goal construction', async () => {
    mockRoslib.response = { typedefs: [
      { type: 'control_msgs/action/FollowJointTrajectory_Goal', fieldnames: ['trajectory'], fieldtypes: ['trajectory_msgs/msg/JointTrajectory'], fieldarraylen: [-1] },
      { type: 'trajectory_msgs/msg/JointTrajectory', fieldnames: ['points'], fieldtypes: ['trajectory_msgs/msg/JointTrajectoryPoint'], fieldarraylen: [0] },
      { type: 'trajectory_msgs/msg/JointTrajectoryPoint', fieldnames: ['positions', 'time_from_start'], fieldtypes: ['float64', 'builtin_interfaces/msg/Duration'], fieldarraylen: [0, -1] },
      { type: 'builtin_interfaces/msg/Duration', fieldnames: ['sec', 'nanosec'], fieldtypes: ['int32', 'uint32'], fieldarraylen: [-1, -1] },
    ] };
    const details = await fetchActionGoalDetails({} as never, 'control_msgs/action/FollowJointTrajectory');
    const points = details?.fields[0].subfields?.[0];
    expect(points?.arrayLen).toBe(0);
    expect(points?.subfields?.map(field => field.name)).toEqual(['positions', 'time_from_start']);
    expect(points?.subfields?.[1].subfields?.map(field => field.name)).toEqual(['sec', 'nanosec']);
  });

  it('builds primitive defaults for ROS 2 IDL aliases from action_goal_details', async () => {
    mockRoslib.response = {
      typedefs: [
        {
          type: 'manipulator_action_interfaces/MoveEndEffector_Goal',
          fieldnames: [
            'relative',
            'x',
            'y',
            'z',
            'yaw',
            'position_tolerance',
            'yaw_tolerance',
            'timeout',
          ],
          fieldtypes: ['boolean', 'double', 'double', 'double', 'double', 'double', 'double', 'double'],
          fieldarraylen: [-1, -1, -1, -1, -1, -1, -1, -1],
          constnames: [
            'SLOT_TYPES',
            'position_tolerance',
            'relative',
            'timeout',
            'x',
            'y',
            'yaw',
            'yaw_tolerance',
            'z',
          ],
          constvalues: [
            '(<rosidl_parser.definition.BasicType object at 0x1>,)',
            '0.0',
            'False',
            '0.0',
            '0.0',
            '0.0',
            '0.0',
            '0.0',
            '0.0',
          ],
        },
      ],
    };

    const details = await fetchActionGoalDetails({} as any, 'manipulator_action_interfaces/action/MoveEndEffector');

    expect(details?.defaults).toEqual({
      relative: false,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      position_tolerance: 0,
      yaw_tolerance: 0,
      timeout: 0,
    });
    expect(details?.fields.map(field => [field.name, field.rosType, field.subfields])).toEqual([
      ['relative', 'boolean', undefined],
      ['x', 'double', undefined],
      ['y', 'double', undefined],
      ['z', 'double', undefined],
      ['yaw', 'double', undefined],
      ['position_tolerance', 'double', undefined],
      ['yaw_tolerance', 'double', undefined],
      ['timeout', 'double', undefined],
    ]);
  });
});

describe('fetchServiceRequestSchema', () => {
  beforeEach(() => {
    mockRoslib.calls = [];
    mockRoslib.response = null;
  });

  it('treats empty service requests as valid schemas without falling back to message_details', async () => {
    mockRoslib.response = {
      typedefs: [
        {
          type: 'std_srvs/Trigger_Request',
          fieldnames: [],
          fieldtypes: [],
          fieldarraylen: [],
          constnames: [],
          constvalues: [],
        },
      ],
    };

    const details = await fetchServiceRequestSchema({} as any, 'std_srvs/srv/Trigger');

    expect(details).toEqual({ fields: [], defaults: {} });
    expect(mockRoslib.calls).toHaveLength(1);
    expect(mockRoslib.calls[0].options).toMatchObject({
      name: '/rosapi/service_request_details',
      serviceType: 'rosapi_msgs/srv/ServiceRequestDetails',
    });
  });
});
