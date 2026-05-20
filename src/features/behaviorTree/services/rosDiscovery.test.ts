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

import { fetchActionGoalDetails } from './rosDiscovery';

describe('fetchActionGoalDetails', () => {
  beforeEach(() => {
    mockRoslib.calls = [];
    mockRoslib.response = null;
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
