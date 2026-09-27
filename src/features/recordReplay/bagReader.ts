import { McapIndexedReader } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import { parse } from '@foxglove/rosmsg';
import { MessageReader as Ros2Reader } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1Reader } from '@foxglove/rosmsg-serialization';
import { decompress as zstd } from 'fzstd';
import { decompressLz4Frame } from './lz4';
import type { BagInfo, ReplayMessage } from './types';

export interface TimedMessage extends ReplayMessage {
  /** Encoded size, used to bound worker batches. */
  size: number;
}
const NS = 1_000_000_000n;
/** tf2 keeps 10 s by default; older dynamic transforms are stale for every consumer. */
const TF_LOOKBACK = 30n * NS;

/**
 * Give panels the message shapes rosbridge delivers live: int64 as numbers (bigint would break their
 * arithmetic) and numeric arrays as plain arrays (panels index them, e.g. a Time Series signal on
 * `position[3]`). Byte arrays stay typed: they carry image and point-cloud payloads, and rosbridge's own
 * form for them (base64) would only have to be decoded again.
 */
const toRosbridgeValues = (value: unknown): unknown => {
  if (typeof value === 'bigint') return Number(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof BigInt64Array || value instanceof BigUint64Array) return Array.from(value, Number);
  if (value instanceof Uint8Array || value instanceof Int8Array || value instanceof Uint8ClampedArray || value instanceof DataView) return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) value[index] = toRosbridgeValues(value[index]);
  } else {
    const record = value as Record<string, unknown>;
    for (const key in record) record[key] = toRosbridgeValues(record[key]);
  }
  return value;
};

const MAX_CHUNK = 256 * 1024 * 1024;
const checkSize = (size: bigint) => {
  if (size > BigInt(MAX_CHUNK)) throw new Error('This MCAP contains a chunk larger than 256 MiB. Re-chunk the file before opening it.');
  return Number(size);
};

/** File-backed random access. Only summary indexes and requested chunks enter memory. */
export class BagReader {
  private reader!: McapIndexedReader;
  private decoders = new Map<number, (bytes: Uint8Array) => Record<string, unknown>>();
  info!: BagInfo;

  async open(file: File): Promise<BagInfo> {
    const blob = new BlobReadable(file);
    this.reader = await McapIndexedReader.Initialize({
      readable: { size: () => blob.size(), read: (offset, size) => { checkSize(size); return blob.read(offset, size); } },
      messageIndexCacheSizeBytes: 8 * 1024 * 1024,
      decompressHandlers: {
        // Pure JS: no wasm loader or CSP exception is needed on web, desktop or mobile.
        zstd: (bytes, size) => zstd(bytes, new Uint8Array(checkSize(size))),
        lz4: (bytes, size) => decompressLz4Frame(bytes, checkSize(size)),
      },
    });
    if (!this.reader.chunkIndexes.length) throw new Error('This MCAP has no chunk index. Open an indexed MCAP (the default ros2 bag format), or re-index it with the MCAP CLI.');
    const topics = new Map<string, BagInfo['topics'][number]>();
    this.decoders.clear();
    for (const channel of this.reader.channelsById.values()) {
      const schema = this.reader.schemasById.get(channel.schemaId);
      const topic = { name: channel.topic, type: schema?.name ?? channel.messageEncoding, count: Number(this.reader.statistics?.channelMessageCounts.get(channel.id) ?? 0n), error: undefined as string | undefined };
      try {
        const definition = schema && new TextDecoder().decode(schema.data);
        if (channel.messageEncoding === 'json') {
          this.decoders.set(channel.id, bytes => JSON.parse(new TextDecoder().decode(bytes)));
        } else if (schema?.encoding === 'ros2msg' && channel.messageEncoding === 'cdr') {
          const decoder = new Ros2Reader(parse(definition!, { ros2: true }));
          this.decoders.set(channel.id, bytes => decoder.readMessage(bytes));
        } else if (schema?.encoding === 'ros1msg' && channel.messageEncoding === 'ros1') {
          const decoder = new Ros1Reader(parse(definition!));
          this.decoders.set(channel.id, bytes => decoder.readMessage(bytes));
        } else throw new Error(`Unsupported encoding: ${schema?.encoding ?? 'no schema'} / ${channel.messageEncoding}`);
      } catch (error) { topic.error = String(error); }
      const existing = topics.get(topic.name);
      if (existing) { existing.count += topic.count; existing.error ||= topic.error; }
      else topics.set(topic.name, topic);
    }
    const indexes = this.reader.chunkIndexes;
    this.info = {
      name: file.name, size: file.size,
      start: indexes.reduce((a, c) => c.messageStartTime < a ? c.messageStartTime : a, indexes[0].messageStartTime),
      end: indexes.reduce((a, c) => c.messageEndTime > a ? c.messageEndTime : a, indexes[0].messageEndTime),
      topics: [...topics.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    return this.info;
  }

  async *read(start: bigint, end: bigint | undefined, topics: string[], reverse = false): AsyncGenerator<TimedMessage> {
    if (!topics.length) return;
    for await (const record of this.reader.readMessages({ startTime: start, endTime: end, topics, reverse })) {
      const decode = this.decoders.get(record.channelId);
      if (!decode) continue;
      yield {
        topic: this.reader.channelsById.get(record.channelId)!.topic, time: record.logTime,
        message: toRosbridgeValues(decode(record.data)) as Record<string, unknown>, size: record.data.byteLength,
      };
    }
  }

  /**
   * Causal state at the cursor: the latest message per topic. Each topic is read backwards on its
   * own, so a sparse topic never forces decoding every dense message in between. TF messages are
   * deltas, so they merge by child frame; dynamic TF only looks back as far as tf2 would keep it.
   */
  async seek(time: bigint, topics: string[], cancelled: () => boolean): Promise<ReplayMessage[]> {
    const result: ReplayMessage[] = [];
    for (const topic of topics) {
      if (cancelled()) return [];
      if (topic !== '/tf' && topic !== '/tf_static') {
        for await (const item of this.read(this.info.start, time, [topic], true)) {
          result.push({ topic: item.topic, time: item.time, message: item.message });
          break;
        }
        continue;
      }
      const from = topic === '/tf' && time - TF_LOOKBACK > this.info.start ? time - TF_LOOKBACK : this.info.start;
      const frames = new Map<string, unknown>();
      for await (const item of this.read(from, time, [topic], true)) {
        if (cancelled()) return [];
        for (const transform of (item.message.transforms ?? []) as { child_frame_id: string }[]) {
          if (!frames.has(transform.child_frame_id)) frames.set(transform.child_frame_id, transform);
        }
      }
      if (frames.size) result.push({ topic, time, message: { transforms: [...frames.values()] } });
    }
    return result.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  }
}
