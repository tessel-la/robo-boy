import { BagReader } from './bagReader';
import type { ReaderRequest, ReaderResponse, ReplayMessage } from './types';

const reader = new BagReader();
let generation = 0;
let acknowledge: (() => void) | undefined;
let ackId = 0;
const send = (response: ReaderResponse) => postMessage(response);
onmessage = async ({ data }: MessageEvent<ReaderRequest | { op: 'ack'; id: number }>) => {
  if (data.op === 'ack') { if (data.id === ackId) { acknowledge?.(); acknowledge = undefined; } return; }
  acknowledge?.(); acknowledge = undefined;
  const token = ++generation;
  const cancelled = () => token !== generation;
  try {
    if (data.op === 'open') {
      const info = await reader.open(data.file);
      if (!cancelled()) send({ id: data.id, op: 'opened', info });
    } else if (data.op === 'seek') {
      const messages = await reader.seek(data.time, data.topics, cancelled);
      if (!cancelled()) send({ id: data.id, op: 'messages', messages, done: true });
    } else {
      let messages: ReplayMessage[] = [];
      let bytes = 0;
      for await (const message of reader.read(data.start, data.end, data.topics)) {
        if (cancelled()) return;
        messages.push(message);
        // Bound each structured-clone batch, even for very dense scalar topics.
        bytes += 1;
        if (bytes >= 256) {
          ackId = data.id;
          const consumed = new Promise<void>(resolve => { acknowledge = resolve; });
          send({ id: data.id, op: 'messages', messages, done: false });
          messages = []; bytes = 0;
          await consumed;
        }
      }
      if (!cancelled()) send({ id: data.id, op: 'messages', messages, done: true });
    }
  } catch (error) {
    if (!cancelled()) send({ id: data.id, op: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};
