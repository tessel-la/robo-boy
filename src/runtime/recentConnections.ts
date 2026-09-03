import type { ConnectionParams } from '../App';
import { normalizeConnectionHost } from './connectionHost';
import { getDefaultServicePorts, normalizeRuntimeServicePorts } from './runtimeConfig';

export const RECENT_CONNECTIONS_STORAGE_KEY = 'robo-boy-recent-connections';
export const MAX_RECENT_CONNECTIONS = 5;

export interface RecentConnection {
  host: string;
  rosbridgePort?: string;
  videoStreamPort?: string;
  meshResourcesPort?: string;
  lastConnectedAt: number;
}

const isRecentConnection = (value: unknown): value is RecentConnection => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RecentConnection>;
  return (
    typeof candidate.host === 'string' &&
    typeof candidate.lastConnectedAt === 'number' &&
    (candidate.rosbridgePort === undefined || typeof candidate.rosbridgePort === 'string') &&
    (candidate.videoStreamPort === undefined || typeof candidate.videoStreamPort === 'string') &&
    (candidate.meshResourcesPort === undefined || typeof candidate.meshResourcesPort === 'string')
  );
};

export const loadRecentConnections = (): RecentConnection[] => {
  try {
    const stored = window.localStorage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const defaultPorts = getDefaultServicePorts();

    return parsed
      .filter(isRecentConnection)
      .map(connection => {
        const ports = normalizeRuntimeServicePorts(connection, defaultPorts);
        return {
          host: normalizeConnectionHost(connection.host),
          ...ports,
          lastConnectedAt: connection.lastConnectedAt,
        };
      })
      .filter(connection => connection.host)
      .sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)
      .slice(0, MAX_RECENT_CONNECTIONS);
  } catch {
    return [];
  }
};

export const saveRecentConnection = (params: ConnectionParams, connectedAt = Date.now()): RecentConnection[] => {
  if (params.ros2Option !== 'ip') return loadRecentConnections();

  const host = normalizeConnectionHost(String(params.ros2Value));
  if (!host) return loadRecentConnections();

  const ports = normalizeRuntimeServicePorts(params, getDefaultServicePorts());
  const existing = loadRecentConnections().filter(connection => connection.host.toLowerCase() !== host.toLowerCase());
  const next = [{ host, ...ports, lastConnectedAt: connectedAt }, ...existing].slice(0, MAX_RECENT_CONNECTIONS);

  try {
    window.localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Recent connections are convenience state; connection should continue.
  }

  return next;
};

export const removeRecentConnection = (host: string): RecentConnection[] => {
  const normalizedHost = normalizeConnectionHost(host).toLowerCase();
  const next = loadRecentConnections().filter(connection => connection.host.toLowerCase() !== normalizedHost);

  try {
    window.localStorage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors; the in-memory result is still useful to the UI.
  }

  return next;
};
