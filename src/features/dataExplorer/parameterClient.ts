import type { Ros } from 'roslib';
import { runSerializedRosapi } from '../../utils/rosapiQueue';
import { createUuid } from '../../utils/uuid';
import { controlSessionFor } from '../robotControl/ControlSession';
import {
  decodeParameter,
  draftConflict,
  encodeParameter,
  isParameterNodeName,
  type NodeParameter,
  type ParameterDescriptor,
  type ParameterDraft,
} from './parametersModel';

export const PARAMETER_LIMIT = 512;
type RpcRos = Ros & { callOnConnection: (message: Record<string, unknown>) => void };

/** Uses the shared queue; an aborted in-flight read keeps its slot until response/timeout. */
function call<T>(
  ros: Ros,
  service: string,
  type: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  beforeSend?: () => void
): Promise<T> {
  return runSerializedRosapi(
    ros,
    () =>
      new Promise<T>((resolve, reject) => {
        if (!ros.isConnected) {
          reject(new Error('ROS is disconnected.'));
          return;
        }
        try {
          beforeSend?.();
        } catch (error) {
          reject(error);
          return;
        }
        const id = `parameters-${createUuid()}`;
        const finish = (error?: Error, values?: T) => {
          clearTimeout(timer);
          ros.off(id, response);
          ros.off('close', closed);
          error ? reject(error) : resolve(values as T);
        };
        const response = (message: { result?: boolean; values?: T }) =>
          message.result === false
            ? finish(
                new Error(
                  typeof message.values === 'string' ? message.values : 'Parameter service rejected the request.'
                )
              )
            : finish(undefined, message.values);
        const closed = () => finish(new Error('ROS disconnected during the parameter request.'));
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                `${service} timed out.${service.includes('/set_parameters') ? ' The update may still finish; refresh before retrying.' : ' Check that the node and its parameter services are available.'}`
              )
            ),
          8000
        );
        ros.on(id, response);
        ros.on('close', closed);
        try {
          (ros as RpcRos).callOnConnection({ op: 'call_service', id, service, type, args });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    signal
  );
}

export interface ParameterSnapshot {
  parameters: NodeParameter[];
  total: number;
  atomic: boolean;
  writable: boolean;
}

export function parameterWriteBlock(ros: Ros | null): string | undefined {
  const session = controlSessionFor(ros);
  const status = session?.getSnapshot();
  if (!ros?.isConnected || !session?.hasRecentStatus() || !status)
    return 'Connect to an updated robot control gateway before applying changes.';
  if (
    !status.ready ||
    status.state === 'blocked' ||
    status.state === 'draining' ||
    status.managing ||
    (status.external?.enabled && !status.external.allowControl)
  )
    return status.reason || 'Robot control is unavailable or reserved by running work.';
  if (status.enabled !== false && (status.owner !== status.selfId || !status.token))
    return 'Request control from the top bar before applying changes.';
}

export async function loadNodeParameters(ros: Ros, node: string, signal: AbortSignal): Promise<ParameterSnapshot> {
  if (!isParameterNodeName(node)) throw new Error('Select a valid absolute ROS node name.');
  const listing = await call<{ result: { names: string[] } }>(
    ros,
    `${node}/list_parameters`,
    'rcl_interfaces/srv/ListParameters',
    { prefixes: [], depth: 0 },
    signal
  );
  if (
    !Array.isArray(listing?.result?.names) ||
    !listing.result.names.every(name => typeof name === 'string' && name.length > 0 && name.length <= 512)
  )
    throw new Error('The node returned an invalid parameter list.');
  const allNames = [...new Set(listing.result.names)].sort();
  const names = allNames.slice(0, PARAMETER_LIMIT);
  const parameters: NodeParameter[] = [];
  for (let start = 0; start < names.length; start += 32) {
    const batch = names.slice(start, start + 32);
    const values = await call<{ values: Record<string, unknown>[] }>(
      ros,
      `${node}/get_parameters`,
      'rcl_interfaces/srv/GetParameters',
      { names: batch },
      signal
    );
    const descriptors = await call<{ descriptors: ParameterDescriptor[] }>(
      ros,
      `${node}/describe_parameters`,
      'rcl_interfaces/srv/DescribeParameters',
      { names: batch },
      signal
    );
    if (
      !Array.isArray(values?.values) ||
      values.values.length !== batch.length ||
      !Array.isArray(descriptors?.descriptors) ||
      descriptors.descriptors.length !== batch.length
    )
      throw new Error('The node returned an incomplete parameter response.');
    batch.forEach((name, index) =>
      parameters.push(decodeParameter(name, values.values[index], descriptors.descriptors[index]))
    );
  }
  const details = await call<{ services: string[] }>(
    ros,
    '/rosapi/node_details',
    'rosapi_msgs/srv/NodeDetails',
    { node },
    signal
  );
  const services = Array.isArray(details?.services) ? details.services : [];
  return {
    parameters,
    total: allNames.length,
    atomic: services.includes(`${node}/set_parameters_atomically`),
    writable: services.includes(`${node}/set_parameters_atomically`) || services.includes(`${node}/set_parameters`),
  };
}

/** No automatic retry or fallback after a write: a transport failure leaves its outcome uncertain. */
export async function applyNodeParameters(
  ros: Ros,
  node: string,
  drafts: Record<string, ParameterDraft>,
  atomic: boolean,
  signal: AbortSignal
) {
  const block = parameterWriteBlock(ros);
  if (block) throw new Error(block);
  if (node.startsWith('/roboboy/control/external/'))
    throw new Error('Robot-side control policy is read-only in Robo-Boy.');
  const fresh = await loadNodeParameters(ros, node, signal);
  if (fresh.atomic !== atomic)
    throw new Error('The node’s update service changed. Refresh and review the changes again.');
  const entries = Object.entries(drafts);
  if (!entries.length || entries.length > 32) throw new Error('Stage between 1 and 32 changes per node.');
  for (const [name, draft] of entries) {
    const conflict = draftConflict(
      draft,
      fresh.parameters.find(item => item.name === name)
    );
    if (conflict) throw new Error(`${name}: ${conflict}`);
  }
  if (!fresh.writable) throw new Error('This node does not expose a parameter update service.');
  const parameters = entries.map(([name, draft]) =>
    encodeParameter(fresh.parameters.find(item => item.name === name)!, draft.value)
  );
  const service = atomic ? 'set_parameters_atomically' : 'set_parameters';
  const response = await call<{
    result?: { successful: boolean; reason: string };
    results?: { successful: boolean; reason: string }[];
  }>(
    ros,
    `${node}/${service}`,
    `rcl_interfaces/srv/${atomic ? 'SetParametersAtomically' : 'SetParameters'}`,
    { parameters },
    signal,
    () => {
      const block = parameterWriteBlock(ros);
      if (block) throw new Error(block);
    }
  );
  const results = atomic ? entries.map(() => response?.result) : response?.results;
  if (
    !Array.isArray(results) ||
    results.length !== entries.length ||
    results.some(result => typeof result?.successful !== 'boolean')
  )
    throw new Error('The update response was invalid. Refresh to verify the live values before retrying.');
  return entries.map(([name], index) => ({
    name,
    successful: results[index]!.successful,
    reason: results[index]!.reason || '',
  }));
}
