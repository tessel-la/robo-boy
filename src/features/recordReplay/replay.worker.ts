import { BagReader, type TimedMessage } from './bagReader';
import type { ReaderRequest, ReaderResponse, ReplayMessage } from './types';

// Each structured-clone batch stays small, even for dense scalar topics or large point clouds.
const BATCH_MESSAGES = 256;
const BATCH_BYTES = 8 * 1024 * 1024;

const reader = new BagReader();
let generation = 0;
let readingToken = 0;
let acknowledge: (() => void) | undefined;
let ackId = 0;
/**
 * Playback asks for consecutive windows of a few tens of milliseconds. The MCAP reader only keeps
 * decompressed chunks for the life of one iterator, so one forward iterator stays open across
 * windows; otherwise every window would read and decompress the same chunk again.
 */
let stream: { key: string; next: bigint; iterator: AsyncIterator<TimedMessage>; pending?: TimedMessage } | undefined;

const send = (response: ReaderResponse) => postMessage(response);
// Browsers report a file they may not read as a vague abort (Firefox: "The operation was aborted").
const UNREADABLE = ['AbortError', 'NotReadableError', 'NotFoundError', 'SecurityError'];
const describe = (error: unknown) =>
  error instanceof DOMException && UNREADABLE.includes(error.name)
    ? 'The browser could not read this file. Check that your user owns it: snap browsers only open files you own.'
    : error instanceof Error ? error.message : String(error);
onmessage = async ({ data }: MessageEvent<ReaderRequest | { op: 'ack'; id: number }>) => {
  if (data.op === 'ack') { if (data.id === ackId) { acknowledge?.(); acknowledge = undefined; } return; }
  acknowledge?.(); acknowledge = undefined;
  // An interrupted read consumed messages nobody received; its iterator cannot be continued.
  if (readingToken) { stream = undefined; readingToken = 0; }
  const token = ++generation;
  const cancelled = () => token !== generation;
  try {
    if (data.op === 'open') {
      stream = undefined;
      const info = await reader.open(data.file);
      if (!cancelled()) send({ id: data.id, op: 'opened', info });
    } else if (data.op === 'seek') {
      const messages = await reader.seek(data.time, data.topics, cancelled);
      if (!cancelled()) send({ id: data.id, op: 'messages', messages, done: true });
    } else {
      const key = data.topics.join('\n');
      if (!stream || stream.key !== key || stream.next !== data.start) {
        stream = { key, next: data.start, iterator: reader.read(data.start, undefined, data.topics)[Symbol.asyncIterator]() };
      }
      const current = stream;
      readingToken = token;
      let messages: ReplayMessage[] = [];
      let bytes = 0;
      for (;;) {
        let item = current.pending;
        current.pending = undefined;
        if (!item) {
          const next = await current.iterator.next();
          if (cancelled()) return;
          if (next.done) break;
          item = next.value;
        }
        if (item.time > data.end) { current.pending = item; break; }
        messages.push({ topic: item.topic, time: item.time, message: item.message });
        bytes += item.size;
        if (messages.length >= BATCH_MESSAGES || bytes >= BATCH_BYTES) {
          ackId = data.id;
          const consumed = new Promise<void>(resolve => { acknowledge = resolve; });
          send({ id: data.id, op: 'messages', messages, done: false });
          messages = []; bytes = 0;
          await consumed;
          if (cancelled()) return;
        }
      }
      current.next = data.end + 1n;
      readingToken = 0;
      send({ id: data.id, op: 'messages', messages, done: true });
    }
  } catch (error) {
    if (readingToken === token) { stream = undefined; readingToken = 0; }
    if (!cancelled()) send({ id: data.id, op: 'error', error: describe(error) });
  }
};
