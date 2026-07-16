import React, { createContext, useContext, useMemo } from 'react';
import type { ConnectionParams } from '../App';

export interface RuntimeEndpoints {
  rosbridgeUrl: string;
  videoStreamBaseUrl: string;
  meshResourcesBaseUrl: string;
  mode: 'web' | 'desktop';
  host: string;
}

export interface RuntimePortConfig {
  rosbridgePort: string;
  videoStreamPort: string;
  meshResourcesPort: string;
}

type BrowserLocation = Pick<Location, 'protocol' | 'hostname'> & Partial<Pick<Location, 'host'>>;

const readPortEnv = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : fallback;
};

export const getRuntimePortConfig = (): RuntimePortConfig => ({
  rosbridgePort: readPortEnv(import.meta.env.VITE_ROSBRIDGE_PORT, '9090'),
  videoStreamPort: readPortEnv(import.meta.env.VITE_VIDEO_STREAM_PORT, '8080'),
  meshResourcesPort: readPortEnv(import.meta.env.VITE_MESH_RESOURCES_PORT, '8000'),
});

const getBrowserLocation = (): BrowserLocation => {
  if (typeof window === 'undefined') {
    return { protocol: 'http:', hostname: 'localhost', host: 'localhost' };
  }
  return window.location;
};

export const isDesktopRuntime = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

const normalizeHost = (value: string): string => {
  const candidate = value.trim();
  if (!candidate) return 'localhost';

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
    return parsed.hostname.replace(/^\[|\]$/g, '') || 'localhost';
  } catch {
    return candidate.replace(/^\[|\]$/g, '') || 'localhost';
  }
};

export function resolveRuntimeEndpoints(
  params?: ConnectionParams | null,
  desktop = isDesktopRuntime(),
  location = getBrowserLocation(),
  ports = getRuntimePortConfig()
): RuntimeEndpoints {
  if (!desktop) {
    const authority = location.host || location.hostname;
    const websocketScheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return {
      rosbridgeUrl: `${websocketScheme}://${authority}/websocket`,
      videoStreamBaseUrl: '/video_stream',
      meshResourcesBaseUrl: '/mesh_resources',
      mode: 'web',
      host: location.hostname,
    };
  }

  const configuredHost = params?.ros2Option === 'ip' ? String(params.ros2Value) : '';
  const host = normalizeHost(configuredHost);
  const urlHost = host.includes(':') ? `[${host}]` : host;

  return {
    rosbridgeUrl: `ws://${urlHost}:${ports.rosbridgePort}`,
    videoStreamBaseUrl: `http://${urlHost}:${ports.videoStreamPort}`,
    meshResourcesBaseUrl: `http://${urlHost}:${ports.meshResourcesPort}`,
    mode: 'desktop',
    host,
  };
}

const RuntimeConfigContext = createContext<RuntimeEndpoints>(resolveRuntimeEndpoints());

export function RuntimeConfigProvider({
  connectionParams,
  children,
}: {
  connectionParams: ConnectionParams | null;
  children: React.ReactNode;
}) {
  const endpoints = useMemo(() => resolveRuntimeEndpoints(connectionParams), [connectionParams]);
  return <RuntimeConfigContext.Provider value={endpoints}>{children}</RuntimeConfigContext.Provider>;
}

export const useRuntimeConfig = (): RuntimeEndpoints => useContext(RuntimeConfigContext);

export const getDefaultConnectionHost = (): string => {
  return isDesktopRuntime() ? 'localhost' : getBrowserLocation().hostname;
};
