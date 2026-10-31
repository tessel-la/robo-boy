import type { PointCloudMessage } from '../pointCloudDecoder';

export const CLOUDINI_TYPE = 'point_cloud_interfaces/msg/CompressedPointCloud2';
export const isCompressedPointCloud = (type: string) =>
  type.replace('/msg/', '/') === 'point_cloud_interfaces/CompressedPointCloud2';
const MAX_INPUT = 8 * 1024 * 1024;

/** Bound allocation before copying bytes or invoking WASM. The native shim independently checks its embedded layout. */
export function cloudiniMessage(value: unknown) {
  const message = value as PointCloudMessage & { format?: string; compressed_data?: unknown };
  if (!message || message.format !== 'cloudini') throw new Error('Unsupported compressed point-cloud format.');
  const { width, height, point_step: step, row_step: row, fields } = message;
  if (
    ![width, height, step, row].every(v => Number.isSafeInteger(v) && v >= 0) ||
    !step ||
    step > 256 ||
    width * height > 1_000_000 ||
    width * height * step > 32 * 1024 * 1024 ||
    row !== width * step ||
    message.is_bigendian
  )
    throw new Error('Invalid or oversized compressed point-cloud layout.');
  const sizes = [0, 1, 1, 2, 2, 4, 4, 4, 8];
  const names = new Set<string>();
  const utf8 = new TextEncoder();
  if (!Array.isArray(fields) || !fields.length || fields.length > 64)
    throw new Error('Invalid compressed point-cloud fields.');
  let layout = `${width}:${height}:${step};`;
  for (const field of fields) {
    if (
      !field ||
      typeof field.name !== 'string' ||
      !field.name.length ||
      utf8.encode(field.name).length > 128 ||
      names.has(field.name) ||
      field.count !== 1 ||
      !Number.isInteger(field.datatype) ||
      !sizes[field.datatype] ||
      !Number.isSafeInteger(field.offset) ||
      field.offset < 0 ||
      field.offset + sizes[field.datatype] > step
    )
      throw new Error('Invalid compressed point-cloud fields.');
    names.add(field.name);
    layout += `${utf8.encode(field.name).length}:${field.name}:${field.offset}:${field.datatype};`;
  }
  const data = message.compressed_data;
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    if (data.length > Math.ceil(MAX_INPUT / 3) * 4) throw new Error('Compressed point cloud exceeds 8 MiB.');
    bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  } else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (
    Array.isArray(data) &&
    data.length <= MAX_INPUT &&
    data.every(v => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    bytes = Uint8Array.from(data);
  else throw new Error('Invalid compressed point-cloud bytes.');
  if (bytes.length > MAX_INPUT) throw new Error('Compressed point cloud exceeds 8 MiB.');
  return { message, bytes, layout: utf8.encode(layout), size: width * height * step };
}
