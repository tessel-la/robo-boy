import React, { createContext, useContext, useMemo } from 'react';
import type { ConnectionParams } from '../App';

export interface RuntimeEndpoints {
  rosbridgeUrl: string;
  videoStreamBaseUrl: string;
  meshResourcesBaseUrl: string;
  mode: 'web' | 'desktop';
  host: string;
}

type BrowserLocation = Pick<Location, 'protocol' | 'hostname'> & Partial<Pick<Location, 'host'>>;

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
  location = getBrowserLocation()
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
    rosbridgeUrl: `ws://${urlHost}:9090`,
    videoStreamBaseUrl: `http://${urlHost}:8080`,
    meshResourcesBaseUrl: `http://${urlHost}:8000`,
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
