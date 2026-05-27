/**
 * Default goal parameters for well-known AS2 action types.
 * Used as instant fallback when /rosapi/message_details cannot introspect
 * the type (e.g. package compiled in a different workspace).
 * Also used by the executor when a node has no saved parameters.
 */
export const ACTION_TEMPLATES: Record<string, Record<string, unknown>> = {
  'as2_msgs/action/Takeoff': {
    takeoff_height: 1.0,
    takeoff_speed: 0.5,
  },
  'as2_msgs/action/TakeoffBehavior': {
    takeoff_height: 1.0,
    takeoff_speed: 0.5,
  },
  'as2_msgs/action/Land': {
    land_speed: 0.5,
  },
  'as2_msgs/action/LandBehavior': {
    land_speed: 0.5,
  },
  'as2_msgs/action/GoToWaypoint': {
    yaw: { mode: 0, angle: 0.0 },
    target_pose: {
      header: { frame_id: 'earth' },
      point: { x: 0.0, y: 0.0, z: 1.0 },
    },
    max_speed: 1.0,
  },
  'as2_msgs/action/GoToBehavior': {
    yaw: { mode: 0, angle: 0.0 },
    target_pose: {
      header: { frame_id: 'earth' },
      point: { x: 0.0, y: 0.0, z: 1.0 },
    },
    max_speed: 1.0,
  },
  'as2_msgs/action/FollowPath': {
    path: {
      header: { frame_id: 'earth' },
      poses: [],
    },
    max_speed: 1.0,
    yaw_mode: { mode: 1, angle: 0.0 },
  },
  'as2_msgs/action/FollowPathBehavior': {
    path: {
      header: { frame_id: 'earth' },
      poses: [],
    },
    max_speed: 1.0,
    yaw_mode: { mode: 1, angle: 0.0 },
  },
};
