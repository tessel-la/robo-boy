import { useCallback, useEffect, useState } from 'react';
import type { RemoteBag } from './types';

/** One MCAP file on the ROS host; paths are relative to the recorder's recording root. */
export interface RemoteRecordingFile {
  name: string;
  path: string;
  size: number;
  modified: number;
}
/** A rosbag2 directory. A split recording has one file per part. */
export interface RemoteRecording {
  name: string;
  path: string;
  /** Still being written; it can be opened once the recording stops. */
  active: boolean;
  files: RemoteRecordingFile[];
  duration?: number;
  messages?: number;
}
export interface RemoteListing {
  directory: string;
  folders: string[];
  recordings: RemoteRecording[];
  files: RemoteRecordingFile[];
}

const LIST_TIMEOUT = 8000;

/** Absolute URL of a recording file, so a worker (whose base URL is its script) resolves it the same way. */
export const recordingFileUrl = (baseUrl: string, path: string) =>
  new URL(
    `${baseUrl.replace(/\/+$/, '')}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
    globalThis.location?.href
  ).href;

export const remoteBag = (baseUrl: string, file: RemoteRecordingFile): RemoteBag => ({
  url: recordingFileUrl(baseUrl, file.path),
  name: file.name,
  size: file.size,
});

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const file = (value: unknown): RemoteRecordingFile | undefined => {
  const item = value as Partial<RemoteRecordingFile> | null;
  const size = number(item?.size);
  return item && text(item.name) && text(item.path) && size !== undefined
    ? { name: item.name!, path: item.path!, size, modified: number(item.modified) ?? 0 }
    : undefined;
};
const list = <T>(value: unknown, parse: (item: unknown) => T | undefined) =>
  Array.isArray(value) ? value.map(parse).filter((item): item is T => item !== undefined) : [];

/** Validates the recorder's listing; anything malformed is left out rather than trusted. */
export function parseListing(value: unknown): RemoteListing {
  const data = value as Record<string, unknown> | null;
  if (!data || data.version !== 1)
    throw new Error('The ROS host answered with an unknown recordings format. Update its Robo-Boy recorder.');
  return {
    directory: text(data.directory) === '.' ? '' : text(data.directory),
    folders: list(data.folders, item => text(item) || undefined),
    files: list(data.files, file),
    recordings: list(data.recordings, item => {
      const bag = item as Partial<RemoteRecording> | null;
      if (!bag || !text(bag.name) || !text(bag.path)) return undefined;
      return {
        name: bag.name!,
        path: bag.path!,
        active: bag.active === true,
        files: list(bag.files, file),
        duration: number(bag.duration),
        messages: number(bag.messages),
      };
    }),
  };
}

export async function fetchListing(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<RemoteListing> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/list?path=${encodeURIComponent(path)}`, {
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    const direct = /^https?:\/\//i.test(baseUrl);
    throw new Error(
      direct
        ? `The ROS host’s recordings are not reachable at ${baseUrl}. Check the host, port, firewall and CORS. Direct apps need the recorder's TCP endpoint: set ROBOBOY_RECORDINGS_PORT on the ROS host, then restart its recorder at a safe time. The browser's /recordings proxy may work without that TCP port.`
        : 'The ROS host’s recordings are not reachable through the /recordings proxy. Check the app server, network connection and recorder socket/upstream; a TCP port is not required for this route.'
    );
  }
  // The proxy answers 502-504 when it cannot reach the recorder; a server without the service answers 404.
  if (response.status >= 502 && response.status <= 504)
    throw new Error(
      'The recorder on the ROS host did not answer. Check that it is running and up to date: docker compose up -d --build ros-stack caddy.'
    );
  if (response.status === 404 || response.status >= 500)
    throw new Error('The ROS host does not serve its recordings. Update and restart its Robo-Boy recorder.');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('The ROS host answered with something other than a recordings list.');
  }
  if (!response.ok)
    throw new Error(
      text((body as { error?: unknown } | null)?.error) || `The ROS host refused the request (HTTP ${response.status}).`
    );
  return parseListing(body);
}

export type RemoteRecordingsState =
  | { status: 'idle' }
  | { status: 'loading'; path: string; listing?: RemoteListing }
  | { status: 'ready'; path: string; listing: RemoteListing }
  | { status: 'error'; path: string; error: string; listing?: RemoteListing };

/**
 * The listing of one folder of the recording root on the ROS host, reloaded whenever the folder
 * changes, the view is enabled again, or `refresh` is called. A newer request replaces an older one.
 */
export function useRemoteRecordings(baseUrl: string, path: string, enabled: boolean, fetcher?: typeof fetch) {
  const [state, setState] = useState<RemoteRecordingsState>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce(value => value + 1), []);
  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, LIST_TIMEOUT);
    setState(previous => ({
      status: 'loading',
      path,
      listing: previous.status === 'idle' ? undefined : previous.listing,
    }));
    fetchListing(baseUrl, path, controller.signal, fetcher)
      .then(listing => {
        if (!controller.signal.aborted) setState({ status: 'ready', path, listing });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        const message = timedOut
          ? 'The ROS host took too long to list its recordings.'
          : error instanceof Error
            ? error.message
            : String(error);
        setState(previous => ({
          status: 'error',
          path,
          error: message,
          listing: previous.status === 'idle' ? undefined : previous.listing,
        }));
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl, path, enabled, fetcher, nonce]);
  return { state, refresh };
}
