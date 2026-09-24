import { McapWriter, TempBuffer } from '@mcap/core';
import { parse } from '@foxglove/rosmsg';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BagReader } from './bagReader';
import type { ReaderResponse, ReplayMessage } from './types';

const START = 1_700_000_000n * 1_000_000_000n;
const at = (seconds: number) => START + BigInt(Math.round(seconds * 1e9));
const TF = 'test_msgs/Transform[] transforms\n================================================================================\nMSG: test_msgs/Transform\nstring child_frame_id\nfloat64 x';
const VALUE = 'int64 big\nfloat64 x';

/** Ten seconds: /value and /tf at 10 Hz (TF alternating frames a and b), one /sparse message. */
async function createBag(): Promise<File> {
  const buffer = new TempBuffer();
  const writer = new McapWriter({ writable: buffer, chunkSize: 512 });
  await writer.start({ profile: 'ros2', library: 'test' });
  const channel = async (topic: string, name: string, definition: string) => {
    const schemaId = await writer.registerSchema({ name, encoding: 'ros2msg', data: new TextEncoder().encode(definition) });
    const id = await writer.registerChannel({ topic, schemaId, messageEncoding: 'cdr', metadata: new Map() });
    return { id, encode: new MessageWriter(parse(definition, { ros2: true })) };
  };
  const value = await channel('/value', 'test_msgs/msg/Value', VALUE);
  const tf = await channel('/tf', 'tf2_msgs/msg/TFMessage', TF);
  const sparse = await channel('/sparse', 'test_msgs/msg/Value', VALUE);
  let sequence = 0;
  const add = (target: typeof value, time: bigint, message: unknown) =>
    writer.addMessage({ channelId: target.id, sequence: sequence++, logTime: time, publishTime: time, data: target.encode.writeMessage(message) });
  for (let step = 0; step < 100; step++) {
    const time = at(step / 10);
    await add(value, time, { big: BigInt(step), x: step / 10 });
    await add(tf, time, { transforms: [{ child_frame_id: step % 2 ? 'b' : 'a', x: step }] });
    if (step === 5) await add(sparse, time, { big: 7n, x: 0.5 });
  }
  await writer.end();
  // jsdom's Blob has no arrayBuffer(); this is the part of File that BlobReadable uses.
  const bytes = buffer.get();
  return { name: 'test.mcap', size: bytes.byteLength, slice: (from: number, to: number) => ({
    arrayBuffer: async () => bytes.slice(from, to).buffer,
  }) } as unknown as File;
}

let bag: File;
beforeAll(async () => { bag = await createBag(); });

describe('BagReader', () => {
  it('opens an indexed MCAP and summarizes its topics', async () => {
    const reader = new BagReader();
    const info = await reader.open(bag);
    expect(info.start).toBe(START);
    expect(info.end).toBe(at(9.9));
    expect(info.topics.map(t => [t.name, t.type, t.count, t.error])).toEqual([
      ['/sparse', 'test_msgs/msg/Value', 1, undefined],
      ['/tf', 'tf2_msgs/msg/TFMessage', 100, undefined],
      ['/value', 'test_msgs/msg/Value', 100, undefined],
    ]);
  });

  it('reads a time window with int64 fields as plain numbers, like rosbridge', async () => {
    const reader = new BagReader();
    await reader.open(bag);
    const messages = [];
    for await (const item of reader.read(at(1), at(2), ['/value'])) messages.push(item);
    expect(messages).toHaveLength(11);
    expect(messages[0].message).toEqual({ big: 10, x: 1 });
  });

  it('seeks to the latest state per topic and merges TF frames', async () => {
    const reader = new BagReader();
    await reader.open(bag);
    const state = await reader.seek(at(5.05), ['/value', '/sparse', '/tf'], () => false);
    const byTopic = Object.fromEntries(state.map(item => [item.topic, item]));
    expect(byTopic['/value'].message).toEqual({ big: 50, x: 5 });
    expect(byTopic['/sparse'].message).toEqual({ big: 7, x: 0.5 });
    expect(byTopic['/tf'].message.transforms).toEqual(
      expect.arrayContaining([{ child_frame_id: 'a', x: 50 }, { child_frame_id: 'b', x: 49 }])
    );
    expect(await reader.seek(at(0.2), ['/sparse'], () => false)).toEqual([]);
  });
});

describe('replay worker', () => {
  it('streams consecutive windows exactly once and restarts cleanly after a seek', async () => {
    const posted: ReaderResponse[] = [];
    vi.stubGlobal('postMessage', (response: ReaderResponse) => posted.push(response));
    await import('./replay.worker');
    const handle = (data: unknown) => (globalThis as unknown as { onmessage: (event: { data: unknown }) => Promise<void> }).onmessage({ data });
    await handle({ id: 1, op: 'open', file: bag });
    expect(posted[posted.length - 1]?.op).toBe('opened');

    const received: ReplayMessage[] = [];
    const window = async (id: number, from: number, to: number) => {
      await handle({ id, op: 'read', start: at(from) + 1n, end: at(to), topics: ['/value'] });
      const response = posted[posted.length - 1];
      if (response.op !== 'messages') throw new Error(response.op);
      received.push(...response.messages);
    };
    await window(2, -1, 0.25);
    await window(3, 0.25, 0.3);
    await window(4, 0.3, 1.05);
    expect(received.map(item => item.message.x)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);

    received.length = 0;
    await handle({ id: 5, op: 'seek', time: at(8), topics: ['/value'] });
    await window(6, 8, 8.35);
    expect(received.map(item => item.message.x)).toEqual([8.1, 8.2, 8.3]);
    vi.unstubAllGlobals();
  });
});
