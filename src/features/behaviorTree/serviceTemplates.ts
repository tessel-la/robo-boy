/**
 * Default request values for well-known ROS service types.
 * Used as fallback when /rosapi/service_request_details cannot introspect
 * the type (older rosapi versions, missing service, or type registration gap).
 *
 * Both full path (std_srvs/srv/SetBool) and short path (std_srvs/SetBool)
 * variants are listed to match whichever format rosapi returns.
 */
export const SERVICE_TEMPLATES: Record<string, Record<string, unknown>> = {
  // std_srvs
  'std_srvs/srv/SetBool':   { data: false },
  'std_srvs/SetBool':       { data: false },
  'std_srvs/srv/SetString': { data: '' },
  'std_srvs/SetString':     { data: '' },
  // std_srvs/Trigger has an empty request — no fields needed

  // as2_msgs common services
  'as2_msgs/srv/SetPlatformStateMachineEvent': { event: { event: 0 } },
  'as2_msgs/SetPlatformStateMachineEvent':     { event: { event: 0 } },
};
