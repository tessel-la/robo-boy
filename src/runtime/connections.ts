import { normalizeConnectionHost } from './connectionHost';
import { getDefaultServicePorts, normalizeRuntimeServicePorts, resolveRuntimeEndpoints } from './runtimeConfig';

export interface ConnectionParams {
  ros2Option: 'domain' | 'ip';
  ros2Value: string | number;
  rosbridgePort?: string;
  videoStreamPort?: string;
  meshResourcesPort?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export interface ConnectionTarget {
  key: string;
  storageScope: string;
  label: string;
  description: string;
  params: ConnectionParams;
}

export const describeConnectionTarget = (params: ConnectionParams): ConnectionTarget => {
  const ports = normalizeRuntimeServicePorts(params, getDefaultServicePorts());
  const isHost = params.ros2Option === 'ip';
  const value = isHost
    ? normalizeConnectionHost(String(params.ros2Value), 'localhost').toLowerCase()
    : String(Math.max(0, Number.parseInt(String(params.ros2Value), 10) || 0));
  const normalizedParams: ConnectionParams = {
    ros2Option: params.ros2Option,
    ros2Value: isHost ? value : Number(value),
    ...ports,
  };
  const endpoints = resolveRuntimeEndpoints(normalizedParams);
  const key = [endpoints.rosbridgeUrl, endpoints.videoStreamBaseUrl, endpoints.meshResourcesBaseUrl].join('|');
  const label = isHost ? value : `Domain ${value}`;

  return {
    key,
    storageScope: `target-${encodeURIComponent(key)}`,
    label,
    description: `${label}; ROS ${ports.rosbridgePort}, video ${ports.videoStreamPort}, mesh ${ports.meshResourcesPort}`,
    params: normalizedParams,
  };
};

export const createConnectionSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `connection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
