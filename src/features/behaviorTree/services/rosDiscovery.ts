import type { Ros } from 'roslib';
import * as ROSLIB from 'roslib';
import { ROSDiscoveryResult, ROSActionInfo, ROSServiceInfo, ROSTopicInfo } from '../types';

/**
 * Discover available ROS actions.
 *
 * Strategy (ROS 2 compatible):
 * 1. Scan visible topics for `/_action/feedback` suffix — catches non-hidden
 *    setups and extracts the type directly from the feedback message type.
 * 2. Call /rosapi/action_servers (uses hidden topics internally) to get the
 *    authoritative list of action server paths.
 * 3. For any server whose type is still unknown, call /rosapi/action_type
 *    SEQUENTIALLY (never in parallel) — concurrent rosbridge service clients
 *    contend on rclpy's node handle lock and drop the WebSocket connection.
 */
export const discoverROSActions = async (ros: Ros): Promise<ROSActionInfo[]> => {
  return new Promise(resolve => {
    const rosApi = ros as any;
    // Confirmed action bases and their interface types.
    const actionTypes = new Map<string, string>();

    // Probe a single candidate path via /rosapi/action_type — MUST be called
    // sequentially, never with Promise.all, to avoid concurrent rosbridge
    // service client creation crashing the WebSocket connection.
    const probeActionType = (candidate: string) =>
      new Promise<void>(done => {
        try {
          const srv = new (ROSLIB as any).Service({
            ros,
            name: '/rosapi/action_type',
            serviceType: 'rosapi_msgs/srv/ActionType',
          });
          srv.callService(
            { action: candidate },
            (res: any) => {
              const t: string = res?.type || '';
              if (t) {
                actionTypes.set(candidate, t);
                console.log(`[BT] Found action server: ${candidate} (${t})`);
              }
              done();
            },
            () => done() // not an action server — ignore silently
          );
        } catch {
          done();
        }
      });

    // Fetch action server names from /rosapi/action_servers (single call,
    // uses hidden topics internally — reliable on ROS 2 Humble).
    const fetchActionServers = (): Promise<string[]> =>
      new Promise<string[]>(done => {
        try {
          const srv = new (ROSLIB as any).Service({
            ros,
            name: '/rosapi/action_servers',
            serviceType: 'rosapi_msgs/srv/GetActionServers',
          });
          srv.callService(
            {},
            (res: any) => {
              const servers: string[] = res?.action_servers || [];
              console.log(`[BT] /rosapi/action_servers returned ${servers.length} server(s):`, servers);
              done(servers);
            },
            () => {
              console.warn('[BT] /rosapi/action_servers failed, skipping Phase 2');
              done([]);
            }
          );
        } catch {
          done([]);
        }
      });

    // Collects bases found via /_action/ infix scan (non-hidden setups).
    const actionBases = new Set<string>();

    const stripFeedbackSuffix = (msgType: string): string =>
      msgType.replace(/_FeedbackMessage$/, '').replace(/_Feedback$/, '');

    let pending = 2;
    const finish = async () => {
      pending -= 1;
      if (pending > 0) return;

      // --- Phase 1: resolve types for bases found via /_action/ infix scan ---
      // Sequential to avoid concurrent rosbridge service client contention.
      const scannedBases = Array.from(actionBases).filter(n => n.startsWith('/'));
      for (const base of scannedBases.filter(b => !actionTypes.has(b))) {
        await probeActionType(base);
      }

      // --- Phase 2: use /rosapi/action_servers for authoritative ROS 2 list ---
      // This endpoint queries hidden topics internally so it works even when
      // action services are not visible in getServices().
      const servers = await fetchActionServers();
      const unprobed = servers.filter(s => !actionTypes.has(s));
      if (unprobed.length > 0) {
        console.log(`[BT] Probing ${unprobed.length} action server(s) for type info (sequential)...`);
        for (const candidate of unprobed) {
          await probeActionType(candidate);
        }
      }

      // Build the final list from all confirmed action servers.
      const actions: ROSActionInfo[] = Array.from(actionTypes.entries()).map(([name, type]) => {
        const parts = name.split('/').filter(Boolean);
        const namespace = parts.slice(0, -1).join('/');
        return { name, type, namespace: namespace || '/' };
      });

      console.log('[BT] Total actions discovered:', actions.length);
      resolve(actions);
    };

    rosApi.getServices(
      (services: string[]) => {
        console.log('[BT] Discovering actions from services:', services.length);
        services.forEach(service => {
          const idx = service.indexOf('/_action');
          if (idx > 0) {
            actionBases.add(service.substring(0, idx));
          }
        });
        finish();
      },
      (error: any) => {
        console.error('[BT] Failed to get service list:', error);
        finish();
      }
    );

    rosApi.getTopics(
      (result: any) => {
        const topics: string[] = result?.topics || [];
        const types: string[] = result?.types || [];
        console.log('[BT] Discovering actions from topics:', topics.length);
        topics.forEach((topic: string, idx: number) => {
          const actionIdx = topic.indexOf('/_action');
          if (actionIdx > 0) {
            actionBases.add(topic.substring(0, actionIdx));
            // Derive the interface type from the feedback topic message type.
            const fbSuffix = '/_action/feedback';
            if (topic.endsWith(fbSuffix) && types[idx]) {
              const base = topic.substring(0, topic.length - fbSuffix.length);
              const interfaceType = stripFeedbackSuffix(types[idx]);
              if (interfaceType) actionTypes.set(base, interfaceType);
            }
          }
        });
        finish();
      },
      (error: any) => {
        console.error('[BT] Failed to get topic list:', error);
        finish();
      }
    );
  });
};

/**
 * Discover available ROS services.
 *
 * Types are resolved sequentially (never in parallel) to avoid concurrent
 * rosbridge service client contention that drops the WebSocket connection.
 */
export const discoverROSServices = async (ros: Ros): Promise<ROSServiceInfo[]> => {
  const rosApi = ros as any;

  const allServices: string[] = await new Promise(resolve => {
    rosApi.getServices(
      (services: string[]) => resolve(services),
      (error: any) => {
        console.error('[BT] Failed to list ROS services:', error);
        resolve([]);
      }
    );
  });

  const filtered = allServices.filter(
    service =>
      !service.startsWith('/rosout') &&
      !service.startsWith('/_') &&
      !service.startsWith('/rosapi/') &&
      !service.includes('/_action/') &&
      !service.includes('/get_loggers') &&
      !service.includes('/set_logger_level') &&
      !service.includes('/describe_parameters') &&
      !service.includes('/get_parameter') &&
      !service.includes('/set_parameter') &&
      !service.includes('/get_parameters') &&
      !service.includes('/set_parameters') &&
      !service.includes('/list_parameters')
  );

  console.log(`[BT] Resolving types for ${filtered.length} service(s) sequentially…`);
  const serviceInfos: ROSServiceInfo[] = [];
  for (const service of filtered) {
    const type = await getServiceType(ros, service);
    serviceInfos.push({ name: service, type: type ?? 'unknown' });
  }
  return serviceInfos;
};

/**
 * Discover available ROS topics suitable for publishing
 */
export const discoverROSTopics = async (ros: Ros): Promise<ROSTopicInfo[]> => {
  return new Promise(resolve => {
    const rosApi = ros as any;
    rosApi.getTopics(
      (result: any) => {
        // Filter out system topics and action-related topics
        const filteredTopics = result.topics
          .map((topic: string, index: number) => ({
            name: topic,
            type: result.types[index],
          }))
          .filter(
            (topic: { name: string; type: string }) =>
              !topic.name.startsWith('/rosout') &&
              !topic.name.includes('/_action/') &&
              !topic.name.startsWith('/_') &&
              !topic.name.includes('/parameter_events') &&
              topic.type !== '' // Filter out topics without type info
          );

        const topicInfos: ROSTopicInfo[] = filteredTopics.map((topic: { name: string; type: string }) => ({
          name: topic.name,
          type: topic.type,
        }));

        resolve(topicInfos);
      },
      (error: any) => {
        console.error('Failed to discover ROS topics:', error);
        resolve([]);
      }
    );
  });
};

/**
 * Discover all available ROS resources (actions, services, topics)
 */
export const discoverAllROSResources = async (ros: Ros): Promise<ROSDiscoveryResult> => {
  try {
    // Keep rosapi introspection serialized. Opening the BT panel can trigger
    // hundreds of service/type requests, and overlapping those calls has caused
    // rosbridge/rosapi disconnects on large ROS 2 graphs.
    const actions = await discoverROSActions(ros);
    const services = await discoverROSServices(ros);
    const topics = await discoverROSTopics(ros);

    return {
      actions,
      services,
      topics,
    };
  } catch (error) {
    console.error('Failed to discover ROS resources:', error);
    return {
      actions: [],
      services: [],
      topics: [],
    };
  }
};

/**
 * Get service type for a specific service
 */
export const getServiceType = async (ros: Ros, serviceName: string): Promise<string | null> => {
  return new Promise(resolve => {
    const rosApi = ros as any;
    rosApi.getServiceType(
      serviceName,
      (type: string) => {
        resolve(type);
      },
      (error: any) => {
        console.error(`Failed to get service type for ${serviceName}:`, error);
        resolve(null);
      }
    );
  });
};

// ── Runtime action goal schema introspection ─────────────────────────────────

interface FieldTypedef {
  type: string;
  fieldnames: string[];
  fieldtypes: string[];
  fieldarraylen: number[];
  constnames: string[];
  constvalues: string[];
}

/** Build a default value for one field from its ROS type. */
function rosDefaultValue(fieldtype: string, arraylen: number, allTypedefs: FieldTypedef[]): unknown {
  const scalar = (): unknown => {
    switch (fieldtype) {
      case 'bool':
      case 'boolean':
        return false;
      case 'string':
        return '';
      case 'byte':
      case 'char':
      case 'int':
      case 'uint':
      case 'int8':
      case 'int16':
      case 'int32':
      case 'int64':
      case 'uint8':
      case 'uint16':
      case 'uint32':
      case 'uint64':
      case 'float':
      case 'double':
      case 'float32':
      case 'float64':
        return 0;
      default: {
        // Complex / nested type — find its typedef and recurse
        const nested = allTypedefs.find(
          t => t.type === fieldtype || t.type.split('/').pop() === fieldtype.split('/').pop()
        );
        return nested ? buildDefaultsFromTypedef(nested, allTypedefs) : {};
      }
    }
  };

  // arraylen == -1 → scalar; 0 → dynamic array (start empty); N → fixed array
  if (arraylen >= 0) {
    return Array.from({ length: arraylen }, scalar);
  }
  return scalar();
}

function buildDefaultsFromTypedef(typedef: FieldTypedef, allTypedefs: FieldTypedef[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const names: string[] = typedef.fieldnames ?? [];
  const types: string[] = typedef.fieldtypes ?? [];
  const lens: number[] = typedef.fieldarraylen ?? [];
  const consts: string[] = typedef.constnames ?? [];

  // Build defaults, skipping only genuine constants (those that also have a
  // constvalue). Some rosapi versions incorrectly list all field names in
  // constnames — so we only skip a name that has a paired constvalue entry.
  names.forEach((name, i) => {
    const constIdx = consts.indexOf(name);
    const hasConstValue = constIdx >= 0 && typedef.constvalues?.[constIdx] !== undefined;
    if (hasConstValue) return; // genuine constant — not a settable field
    const al = lens[i] !== undefined ? lens[i] : -1;
    obj[name] = rosDefaultValue(types[i] ?? 'float64', al, allTypedefs);
  });

  // Safety net: if constnames filtering removed everything despite fieldnames
  // being non-empty, rebuild without any filtering (rosapi bug workaround).
  if (Object.keys(obj).length === 0 && names.length > 0) {
    console.warn('[BT] buildDefaults: constnames filter ate all fields — retrying without filter');
    names.forEach((name, i) => {
      const al = lens[i] !== undefined ? lens[i] : -1;
      obj[name] = rosDefaultValue(types[i] ?? 'float64', al, allTypedefs);
    });
  }

  return obj;
}

async function queryMessageDetails(ros: Ros, type: string): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    try {
      const srv = new (ROSLIB as any).Service({
        ros,
        name: '/rosapi/message_details',
        serviceType: 'rosapi_msgs/srv/MessageDetails',
      });
      srv.callService(
        { type },
        (res: any) => {
          const typedefs: FieldTypedef[] = res?.typedefs ?? [];

          // Full raw log so future type-introspection issues are diagnosable.
          console.log(
            `[BT] /rosapi/message_details("${type}") → ${typedefs.length} typedef(s):`,
            typedefs
              .map(
                t =>
                  `${t.type} fields:[${t.fieldnames?.join(',')}] ` +
                  `types:[${t.fieldtypes?.join(',')}] ` +
                  `lens:[${t.fieldarraylen?.join(',')}] ` +
                  `consts:[${t.constnames?.join(',')}]`
              )
              .join('\n')
          );

          if (!typedefs.length) {
            resolve(null);
            return;
          }

          // The response often contains multiple typedefs (the root type plus
          // all nested message types). The one we want is the Goal message,
          // identified by the suffix of the requested type name.
          const goalSuffix = type.split('/').pop() ?? ''; // e.g. "Takeoff_Goal"
          const targetTypedef =
            // 1. Exact suffix match (most reliable)
            typedefs.find(t => t.type.endsWith(goalSuffix) && t.fieldnames?.length) ??
            // 2. First typedef with actual fields
            typedefs.find(t => t.fieldnames?.length) ??
            null;

          if (!targetTypedef) {
            resolve(null);
            return;
          }

          const defaults = buildDefaultsFromTypedef(targetTypedef, typedefs);
          // Return null if we ended up with an empty object — the caller will
          // try the next candidate or fall back to a hardcoded template.
          resolve(Object.keys(defaults).length > 0 ? defaults : null);
        },
        (err: any) => {
          console.warn(`[BT] /rosapi/message_details("${type}") failed:`, err);
          resolve(null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

async function queryActionGoalSchema(ros: Ros, actionType: string): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    try {
      const srv = new (ROSLIB as any).Service({
        ros,
        name: '/rosapi/action_goal_details',
        serviceType: 'rosapi_msgs/srv/ActionGoalDetails',
      });
      srv.callService(
        { type: actionType },
        (res: any) => {
          const typedefs: FieldTypedef[] = res?.typedefs ?? [];

          console.log(
            `[BT] /rosapi/action_goal_details("${actionType}") → ${typedefs.length} typedef(s):`,
            typedefs.map(t => `${t.type}[${t.fieldnames?.join(',') ?? ''}]`).join(' | ')
          );

          const targetTypedef =
            typedefs.find(t => t.type.endsWith('_Goal') && t.fieldnames?.length) ??
            typedefs.find(t => t.fieldnames?.length) ??
            null;

          if (!targetTypedef) {
            resolve(null);
            return;
          }

          const defaults = buildDefaultsFromTypedef(targetTypedef, typedefs);
          resolve(Object.keys(defaults).length > 0 ? defaults : null);
        },
        (err: any) => {
          console.warn(`[BT] /rosapi/action_goal_details("${actionType}") failed:`, err);
          resolve(null);
        }
      );
    } catch (e) {
      console.warn(`[BT] /rosapi/action_goal_details("${actionType}") exception:`, e);
      resolve(null);
    }
  });
}

/**
 * Fetch the goal message schema for a ROS 2 action and return an object with
 * default values for every field, ready to paste into the parameter editor.
 *
 * Tries two type-string formats to handle different rosapi versions:
 *   1. as2_msgs/action/TakeoffBehavior_Goal
 *   2. as2_msgs/TakeoffBehavior_Goal
 */
export const fetchActionGoalSchema = async (ros: Ros, actionType: string): Promise<Record<string, unknown> | null> => {
  const actionGoalResult = await queryActionGoalSchema(ros, actionType);
  if (actionGoalResult !== null) {
    console.log(`[BT] Got goal schema for "${actionType}" via /rosapi/action_goal_details:`, actionGoalResult);
    return actionGoalResult;
  }

  const parts = actionType.split('/');
  const pkg = parts[0];
  const name = parts[parts.length - 1];

  const candidates = [
    `${actionType}_Goal`, // as2_msgs/action/TakeoffBehavior_Goal
    `${pkg}/${name}_Goal`, // as2_msgs/TakeoffBehavior_Goal
  ];

  for (const candidate of candidates) {
    const result = await queryMessageDetails(ros, candidate);
    if (result !== null) {
      console.log(`[BT] Got goal schema for "${actionType}" via "${candidate}":`, result);
      return result;
    }
  }
  console.warn(`[BT] Could not fetch goal schema for "${actionType}" — tried: ${candidates.join(', ')}`);
  return null;
};

// ── Structured goal schema with per-field type info ──────────────────────────

/** Metadata about a single field in a ROS goal/request message. */
export interface ActionFieldSchema {
  /** Field name, e.g. "takeoff_height" */
  name: string;
  /** ROS primitive or package type, e.g. "float32", "geometry_msgs/Point" */
  rosType: string;
  /** -1 = scalar, 0 = dynamic array, N = fixed-size array */
  arrayLen: number;
  /**
   * Present when `rosType` is a non-primitive message type and its typedef was
   * available in the rosapi response.  Allows the UI to expand nested fields
   * into individual inputs instead of showing a raw JSON textarea.
   */
  subfields?: ActionFieldSchema[];
}

export interface ActionGoalDetails {
  fields: ActionFieldSchema[];
  defaults: Record<string, unknown>;
}

// ROS primitive types that should never be expanded into sub-fields.
const SCHEMA_PRIMITIVES = new Set([
  'bool',
  'boolean',
  'string',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'float32',
  'float64',
  'float',
  'double',
  'int',
  'uint',
  'byte',
  'char',
]);

/**
 * Recursively build ActionFieldSchema[] from a typedef, expanding nested
 * message types up to `depth` levels deep.
 */
function buildSchemaFields(
  typedef: FieldTypedef,
  allTypedefs: FieldTypedef[],
  skipConsts: boolean,
  depth = 0
): ActionFieldSchema[] {
  const names: string[] = typedef.fieldnames ?? [];
  const types: string[] = typedef.fieldtypes ?? [];
  const lens: number[] = typedef.fieldarraylen ?? [];
  const consts: string[] = typedef.constnames ?? [];
  const constvals: string[] = typedef.constvalues ?? [];

  const fields: ActionFieldSchema[] = names.flatMap((name, i) => {
    if (skipConsts) {
      const ci = consts.indexOf(name);
      if (ci >= 0 && constvals[ci] !== undefined) return [];
    }
    const rosType = types[i] ?? 'float64';
    const arrayLen = lens[i] !== undefined ? lens[i] : -1;

    // Attempt to expand nested message types (not arrays, not primitives)
    let subfields: ActionFieldSchema[] | undefined;
    if (depth < 3 && arrayLen === -1 && !SCHEMA_PRIMITIVES.has(rosType)) {
      const nested = allTypedefs.find(t => t.type === rosType || t.type.split('/').pop() === rosType.split('/').pop());
      if (nested?.fieldnames?.length) {
        const sub = buildSchemaFields(nested, allTypedefs, true, depth + 1);
        if (sub.length > 0) subfields = sub;
      }
    }

    return [{ name, rosType, arrayLen, ...(subfields ? { subfields } : {}) }];
  });

  // rosapi bug: constnames filter removed everything — retry without it
  if (fields.length === 0 && names.length > 0 && skipConsts) {
    return buildSchemaFields(typedef, allTypedefs, false, depth);
  }
  return fields;
}

async function queryMessageDetailsFull(
  ros: Ros,
  type: string,
  /** If set, search typedefs for a type ending with this suffix instead of
   *  the last path component of `type`.  Use to find _Request inside a bare
   *  service-type response. */
  targetSuffix?: string
): Promise<ActionGoalDetails | null> {
  return new Promise(resolve => {
    try {
      const srv = new (ROSLIB as any).Service({
        ros,
        name: '/rosapi/message_details',
        serviceType: 'rosapi_msgs/srv/MessageDetails',
      });
      srv.callService(
        { type },
        (res: any) => {
          const typedefs: FieldTypedef[] = res?.typedefs ?? [];

          console.log(
            `[BT] message_details("${type}") → ${typedefs.length} typedef(s):`,
            typedefs.map(t => `${t.type}[${t.fieldnames?.join(',') ?? ''}]`).join(' | ')
          );

          if (!typedefs.length) {
            resolve(null);
            return;
          }

          const suffix = targetSuffix ?? type.split('/').pop() ?? '';
          const targetTypedef =
            typedefs.find(t => t.type.endsWith(suffix)) ?? typedefs.find(t => t.fieldnames?.length) ?? null;

          if (!targetTypedef) {
            console.warn(`[BT] message_details("${type}"): no typedef with suffix "${suffix}" or with fields`);
            resolve(null);
            return;
          }

          const defaults = buildDefaultsFromTypedef(targetTypedef, typedefs);
          const fields = buildSchemaFields(targetTypedef, typedefs, true);

          resolve({ fields, defaults });
        },
        (err: any) => {
          console.warn(`[BT] message_details("${type}") call failed:`, err);
          resolve(null);
        }
      );
    } catch (e) {
      console.warn(`[BT] message_details("${type}") exception:`, e);
      resolve(null);
    }
  });
}

async function queryActionGoalDetails(ros: Ros, actionType: string): Promise<ActionGoalDetails | null> {
  return new Promise(resolve => {
    try {
      const srv = new (ROSLIB as any).Service({
        ros,
        name: '/rosapi/action_goal_details',
        serviceType: 'rosapi_msgs/srv/ActionGoalDetails',
      });
      srv.callService(
        { type: actionType },
        (res: any) => {
          const typedefs: FieldTypedef[] = res?.typedefs ?? [];

          console.log(
            `[BT] action_goal_details("${actionType}") → ${typedefs.length} typedef(s):`,
            typedefs.map(t => `${t.type}[${t.fieldnames?.join(',') ?? ''}]`).join(' | ')
          );

          const targetTypedef =
            typedefs.find(t => t.type.endsWith('_Goal') && t.fieldnames?.length) ??
            typedefs.find(t => t.fieldnames?.length) ??
            null;

          if (!targetTypedef) {
            console.warn(`[BT] action_goal_details("${actionType}"): no goal typedef with fields`);
            resolve(null);
            return;
          }

          const defaults = buildDefaultsFromTypedef(targetTypedef, typedefs);
          const fields = buildSchemaFields(targetTypedef, typedefs, true);
          resolve(fields.length > 0 ? { fields, defaults } : null);
        },
        (err: any) => {
          console.warn(`[BT] action_goal_details("${actionType}") call failed:`, err);
          resolve(null);
        }
      );
    } catch (e) {
      console.warn(`[BT] action_goal_details("${actionType}") exception:`, e);
      resolve(null);
    }
  });
}

/**
 * Fetch the goal message schema for a ROS 2 action, returning both per-field
 * type information and default values.  Useful for building typed form UIs.
 *
 * Tries the same two type-string formats as fetchActionGoalSchema.
 */
export const fetchActionGoalDetails = async (ros: Ros, actionType: string): Promise<ActionGoalDetails | null> => {
  const actionGoalResult = await queryActionGoalDetails(ros, actionType);
  if (actionGoalResult !== null) {
    console.log(`[BT] fetchActionGoalDetails "${actionType}" via /rosapi/action_goal_details:`, actionGoalResult);
    return actionGoalResult;
  }

  const parts = actionType.split('/');
  const pkg = parts[0];
  const name = parts[parts.length - 1];

  const candidates = [`${actionType}_Goal`, `${pkg}/${name}_Goal`];

  for (const candidate of candidates) {
    const result = await queryMessageDetailsFull(ros, candidate);
    if (result !== null) {
      console.log(`[BT] fetchActionGoalDetails "${actionType}" via "${candidate}":`, result);
      return result;
    }
  }
  console.warn(`[BT] fetchActionGoalDetails: no schema for "${actionType}"`);
  return null;
};

/**
 * Primary strategy for service request schema: calls the dedicated
 * /rosapi/service_request_details endpoint which takes the service type
 * directly and reliably returns the request message typedefs.
 */
async function queryServiceRequestDetails(ros: Ros, serviceType: string): Promise<ActionGoalDetails | null> {
  return new Promise(resolve => {
    try {
      const srv = new (ROSLIB as any).Service({
        ros,
        name: '/rosapi/service_request_details',
        serviceType: 'rosapi_msgs/srv/ServiceRequestDetails',
      });
      srv.callService(
        { type: serviceType },
        (res: any) => {
          const typedefs: FieldTypedef[] = res?.typedefs ?? [];
          console.log(
            `[BT] service_request_details("${serviceType}") → ${typedefs.length} typedef(s):`,
            typedefs.map(t => `${t.type}[${t.fieldnames?.join(',') ?? ''}]`).join(' | ')
          );

          if (!typedefs.length) {
            resolve(null);
            return;
          }

          // Prefer typedef ending in _Request; empty request messages are valid.
          const targetTypedef =
            typedefs.find(t => t.type.endsWith('_Request')) ??
            typedefs.find(t => t.fieldnames?.length) ??
            null;

          if (!targetTypedef) {
            resolve(null);
            return;
          }

          const defaults = buildDefaultsFromTypedef(targetTypedef, typedefs);
          const fields = buildSchemaFields(targetTypedef, typedefs, true);
          resolve({ fields, defaults });
        },
        (err: any) => {
          console.warn(`[BT] service_request_details("${serviceType}") failed:`, err);
          resolve(null);
        }
      );
    } catch (e) {
      console.warn(`[BT] service_request_details("${serviceType}") exception:`, e);
      resolve(null);
    }
  });
}

/**
 * Fetch the request message schema for a ROS 2 service, returning both
 * per-field type information and default values.
 *
 * Strategy order:
 *   0. /rosapi/service_request_details  (dedicated endpoint, most reliable)
 *   1. message_details with std_srvs/srv/SetBool_Request
 *   2. message_details with std_srvs/SetBool_Request
 *
 * Do not call /rosapi/message_details with bare service types such as
 * std_srvs/srv/Trigger. Jazzy rosapi can crash when it tries to instantiate a
 * service class as a message class.
 */
export const fetchServiceRequestSchema = async (ros: Ros, serviceType: string): Promise<ActionGoalDetails | null> => {
  if (!serviceType || serviceType === 'unknown') return null;

  // Strategy 0: dedicated rosapi endpoint (most reliable)
  const primary = await queryServiceRequestDetails(ros, serviceType);
  if (primary !== null) {
    console.log(`[BT] fetchServiceRequestSchema "${serviceType}" via service_request_details:`, primary);
    return primary;
  }

  const parts = serviceType.split('/');
  const pkg = parts[0];
  const name = parts[parts.length - 1];

  // Strategy 1 & 2: explicit _Request suffix (full path or short path)
  const explicitCandidates = [
    `${serviceType}_Request`, // e.g. std_srvs/srv/SetBool_Request
    `${pkg}/${name}_Request`, // e.g. std_srvs/SetBool_Request
  ];

  for (const candidate of explicitCandidates) {
    const result = await queryMessageDetailsFull(ros, candidate);
    if (result !== null) {
      console.log(`[BT] fetchServiceRequestSchema "${serviceType}" via "${candidate}":`, result);
      return result;
    }
  }

  console.warn(`[BT] fetchServiceRequestSchema: no schema found for "${serviceType}"`);
  return null;
};

/**
 * Get message type for a specific topic
 */
export const getTopicType = async (ros: Ros, topicName: string): Promise<string | null> => {
  return new Promise(resolve => {
    const rosApi = ros as any;
    rosApi.getTopicType(
      topicName,
      (type: string) => {
        resolve(type);
      },
      (error: any) => {
        console.error(`Failed to get topic type for ${topicName}:`, error);
        resolve(null);
      }
    );
  });
};
