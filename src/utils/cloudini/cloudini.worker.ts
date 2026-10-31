import { decodeCloudini } from './decodeCloudini';

onmessage = async ({ data }: MessageEvent<unknown>) => {
  try {
    const message = await decodeCloudini(data);
    postMessage({ message }, { transfer: [(message.data as Uint8Array).buffer as ArrayBuffer] });
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : 'Point cloud could not be decoded.' });
  }
};
