import createModule, { type CloudiniModule } from './vendor/codec.js';
import type { PointCloudMessage } from '../pointCloudDecoder';
import { cloudiniMessage } from './cloudiniMessage';

let modulePromise: Promise<CloudiniModule> | undefined;

export async function decodeCloudini(value: unknown): Promise<PointCloudMessage> {
  const { message, bytes, layout, size } = cloudiniMessage(value);
  const decoded = {
    header: message.header,
    width: message.width,
    height: message.height,
    fields: message.fields,
    point_step: message.point_step,
    row_step: message.row_step,
    is_bigendian: false,
    data: new Uint8Array(0),
  };
  if (!size && !bytes.length) return decoded;
  if (!bytes.length) throw new Error('Compressed point cloud has no data.');
  const wasm = await (modulePromise ??= createModule().catch(error => {
    modulePromise = undefined;
    throw error;
  }));
  let input = 0,
    output = 0,
    descriptor = 0;
  try {
    input = wasm._malloc(bytes.length);
    output = wasm._malloc(Math.max(1, size));
    descriptor = wasm._malloc(layout.length);
    if (!input || !output || !descriptor) throw new Error('Point-cloud decoder memory limit reached.');
    wasm.HEAPU8.set(bytes, input);
    wasm.HEAPU8.set(layout, descriptor);
    const actual = wasm._roboboy_cloudini_decode(input, bytes.length, output, size, descriptor, layout.length);
    if (actual < 0 || actual !== size) throw new Error('Invalid or incompatible Cloudini payload.');
    decoded.data = wasm.HEAPU8.slice(output, output + size);
    return decoded;
  } finally {
    if (input) wasm._free(input);
    if (output) wasm._free(output);
    if (descriptor) wasm._free(descriptor);
  }
}
