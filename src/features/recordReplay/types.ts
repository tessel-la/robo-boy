export interface BagTopic {
  name: string;
  type: string;
  count: number;
  error?: string;
  /** Message definition text stored with the channel, bounded. */
  definition?: string;
}
export interface BagInfo {
  name: string;
  size: number;
  start: bigint;
  end: bigint;
  topics: BagTopic[];
}
export interface ReplayMessage {
  topic: string;
  time: bigint;
  message: Record<string, unknown>;
}
/** A recording on the ROS host, replayed in place with range requests instead of being copied first. */
export interface RemoteBag {
  url: string;
  name: string;
  size: number;
}
/** What Replay opens: a file on this device, or a recording on the ROS host. */
export type BagSource = File | RemoteBag;
export const isRemoteBag = (source: BagSource): source is RemoteBag => 'url' in source;
export type ReaderRequest =
  | { id: number; op: 'open'; source: BagSource }
  | { id: number; op: 'read'; start: bigint; end: bigint; topics: string[] }
  | { id: number; op: 'seek'; time: bigint; topics: string[] };
export type ReaderResponse =
  | { id: number; op: 'opened'; info: BagInfo }
  | { id: number; op: 'messages'; messages: ReplayMessage[]; done: boolean }
  | { id: number; op: 'error'; error: string };

export interface RecordOptions {
  path: string;
  name: string;
  allTopics: boolean;
  topics: string[];
  include: string;
  exclude: string;
  includeHidden: boolean;
  frequency: number;
  compression: 'none' | 'zstd';
  maxSizeMiB: number;
  maxDurationSec: number;
  cacheMiB: number;
  useSimTime: boolean;
  qos: 'auto' | 'reliable' | 'best_effort';
}
export const defaultRecordOptions = (): RecordOptions => ({
  path: '', name: `recording_${new Date().toISOString().replace(/[:.]/g, '-')}`,
  allTopics: true, topics: [], include: '', exclude: '', includeHidden: false,
  frequency: 0, compression: 'zstd', maxSizeMiB: 0, maxDurationSec: 0,
  cacheMiB: 64, useSimTime: false, qos: 'auto',
});
export interface RecorderStatus {
  version: 1;
  state: 'idle' | 'recording' | 'paused' | 'stopping' | 'error';
  root: string;
  path: string;
  messages: number;
  bytes: number;
  dropped: number;
  elapsed: number;
  topics: string[];
  error?: string;
  requestId?: string;
  requestError?: string;
}
