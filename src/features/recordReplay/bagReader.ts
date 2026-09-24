import { McapIndexedReader } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import { parse } from '@foxglove/rosmsg';
import { MessageReader as Ros2Reader } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1Reader } from '@foxglove/rosmsg-serialization';
import * as zstd from '@foxglove/wasm-zstd';
import lz4 from '@foxglove/wasm-lz4';
import type { BagInfo, ReplayMessage } from './types';

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
    await Promise.all([zstd.isLoaded, lz4.isLoaded]);
    const blob = new BlobReadable(file);
    this.reader = await McapIndexedReader.Initialize({
      readable: { size: () => blob.size(), read: (offset, size) => { checkSize(size); return blob.read(offset, size); } },
      messageIndexCacheSizeBytes: 8 * 1024 * 1024,
      decompressHandlers: {
        zstd: (bytes, size) => zstd.decompress(bytes, checkSize(size)),
        lz4: (bytes, size) => lz4(bytes, checkSize(size)),
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

  async *read(start: bigint, end: bigint, topics: string[], reverse = false): AsyncGenerator<ReplayMessage> {
    if (!topics.length) return;
    for await (const record of this.reader.readMessages({ startTime: start, endTime: end, topics, reverse })) {
      const decode = this.decoders.get(record.channelId);
      if (!decode) continue;
      yield { topic: this.reader.channelsById.get(record.channelId)!.topic, time: record.logTime, message: decode(record.data) };
    }
  }

  /** Causal state at the cursor; TF messages are deltas, so merge by child frame. */
  async seek(time: bigint, topics: string[], cancelled: () => boolean): Promise<ReplayMessage[]> {
    const result = new Map<string, ReplayMessage>();
    const normal = topics.filter(t => t !== '/tf' && t !== '/tf_static');
    for await (const item of this.read(this.info.start, time, normal, true)) {
      if (cancelled()) return [];
      if (!result.has(item.topic)) result.set(item.topic, item);
      if (result.size === normal.length) break;
    }
    for (const topic of topics.filter(t => t === '/tf' || t === '/tf_static')) {
      const frames = new Map<string, unknown>();
      for await (const item of this.read(this.info.start, time, [topic], true)) {
        if (cancelled()) return [];
        for (const transform of (item.message.transforms ?? []) as { child_frame_id: string }[]) {
          if (!frames.has(transform.child_frame_id)) frames.set(transform.child_frame_id, transform);
        }
      }
      if (frames.size) result.set(topic, { topic, time, message: { transforms: [...frames.values()] } });
    }
    return [...result.values()].sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  }
}
