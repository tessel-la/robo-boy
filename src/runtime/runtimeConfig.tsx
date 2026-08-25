import React, { createContext, useContext, useMemo } from 'react';
import type { ConnectionParams } from '../App';
import { normalizeConnectionHost } from './connectionHost';

export interface RuntimeEndpoints {
  rosbridgeUrl: string;
  videoStreamBaseUrl: string;
  meshResourcesBaseUrl: string;
  ollamaBaseUrl: string;
  mode: 'web' | 'desktop';
  host: string;
}

export interface RuntimePortConfig {
  rosbridgePort: string;
  videoStreamPort: string;
  meshResourcesPort: string;
  ollamaPort: string;
  webBackendMode: 'auto' | 'proxy' | 'direct';
}

export type RuntimeServicePorts = Pick<RuntimePortConfig, 'rosbridgePort' | 'videoStreamPort' | 'meshResourcesPort'>;

type BrowserLocation = Pick<Location, 'protocol' | 'hostname'> & Partial<Pick<Location, 'host'>>;

export const normalizeRuntimePort = (value: string | number | undefined, fallback: string): string => {
  if (!value) return fallback;

  const cleanedValue = String(value).trim().replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleanedValue)) return fallback;

  const port = Number.parseInt(cleanedValue, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : fallback;
};

const readWebBackendMode = (value: string | undefined): RuntimePortConfig['webBackendMode'] => {
  return value === 'proxy' || value === 'direct' ? value : 'auto';
};

export const getRuntimePortConfig = (): RuntimePortConfig => ({
  rosbridgePort: normalizeRuntimePort(import.meta.env.VITE_ROSBRIDGE_PORT, '9090'),
  videoStreamPort: normalizeRuntimePort(import.meta.env.VITE_VIDEO_STREAM_PORT, '8080'),
  meshResourcesPort: normalizeRuntimePort(import.meta.env.VITE_MESH_RESOURCES_PORT, '8000'),
  ollamaPort: normalizeRuntimePort(import.meta.env.VITE_OLLAMA_PORT, '11434'),
  webBackendMode: readWebBackendMode(import.meta.env.VITE_WEB_BACKEND_MODE),
});

export const normalizeRuntimeServicePorts = (
  ports: Partial<RuntimeServicePorts> | undefined,
  fallbacks: RuntimeServicePorts
): RuntimeServicePorts => ({
  rosbridgePort: normalizeRuntimePort(ports?.rosbridgePort, fallbacks.rosbridgePort),
  videoStreamPort: normalizeRuntimePort(ports?.videoStreamPort, fallbacks.videoStreamPort),
  meshResourcesPort: normalizeRuntimePort(ports?.meshResourcesPort, fallbacks.meshResourcesPort),
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

const formatUrlHost = (host: string): string => (host.includes(':') ? `[${host}]` : host);

const isSameHost = (configuredHost: string, location: BrowserLocation): boolean => {
  return (
    normalizeConnectionHost(configuredHost, 'localhost').toLowerCase() ===
    normalizeConnectionHost(location.hostname, 'localhost').toLowerCase()
  );
};

const resolveDirectEndpoints = (
  host: string,
  ports: RuntimePortConfig,
  mode: RuntimeEndpoints['mode'],
  location?: BrowserLocation
): RuntimeEndpoints => {
  const urlHost = formatUrlHost(host);
  const secureWebPage = mode === 'web' && location?.protocol === 'https:';
  const websocketScheme = secureWebPage ? 'wss' : 'ws';
  const httpScheme = secureWebPage ? 'https' : 'http';

  return {
    rosbridgeUrl: `${websocketScheme}://${urlHost}:${ports.rosbridgePort}`,
    videoStreamBaseUrl: `${httpScheme}://${urlHost}:${ports.videoStreamPort}`,
    meshResourcesBaseUrl: `${httpScheme}://${urlHost}:${ports.meshResourcesPort}`,
    ollamaBaseUrl: `${httpScheme}://${urlHost}:${ports.ollamaPort}`,
    mode,
    host,
  };
};

export function resolveRuntimeEndpoints(
  params?: ConnectionParams | null,
  desktop = isDesktopRuntime(),
  location = getBrowserLocation(),
  ports = getRuntimePortConfig()
): RuntimeEndpoints {
  const configuredHost = params?.ros2Option === 'ip' ? String(params.ros2Value) : '';
  const host = normalizeConnectionHost(configuredHost, 'localhost');
  const selectedPorts = normalizeRuntimeServicePorts(params ?? undefined, ports);
  const connectionPorts = {
    ...ports,
    ...selectedPorts,
  };

  if (!desktop) {
    const shouldUseDirectBackend =
      params?.ros2Option === 'ip' &&
      connectionPorts.webBackendMode !== 'proxy' &&
      (connectionPorts.webBackendMode === 'direct' || !isSameHost(configuredHost, location));

    if (shouldUseDirectBackend) {
      return resolveDirectEndpoints(host, connectionPorts, 'web', location);
    }

    const authority = location.host || location.hostname;
    const websocketScheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return {
      rosbridgeUrl: `${websocketScheme}://${authority}/websocket`,
      videoStreamBaseUrl: '/video_stream',
      meshResourcesBaseUrl: '/mesh_resources',
      ollamaBaseUrl: '/ollama',
      mode: 'web',
      host: location.hostname,
    };
  }

  return resolveDirectEndpoints(host, connectionPorts, 'desktop');
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

export const getDefaultServicePorts = (): RuntimeServicePorts => {
  const ports = getRuntimePortConfig();
  return {
    rosbridgePort: ports.rosbridgePort,
    videoStreamPort: ports.videoStreamPort,
    meshResourcesPort: ports.meshResourcesPort,
  };
};
