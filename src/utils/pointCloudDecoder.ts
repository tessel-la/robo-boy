/** PointField datatype IDs from sensor_msgs/PointField. */
const fields: Record<number, { size: number; read: (view: DataView, offset: number, little: boolean) => number }> = {
  1: { size: 1, read: (v, o) => v.getInt8(o) },
  2: { size: 1, read: (v, o) => v.getUint8(o) },
  3: { size: 2, read: (v, o, l) => v.getInt16(o, l) },
  4: { size: 2, read: (v, o, l) => v.getUint16(o, l) },
  5: { size: 4, read: (v, o, l) => v.getInt32(o, l) },
  6: { size: 4, read: (v, o, l) => v.getUint32(o, l) },
  7: { size: 4, read: (v, o, l) => v.getFloat32(o, l) },
  8: { size: 8, read: (v, o, l) => v.getFloat64(o, l) },
};

export interface PointCloudMessage {
  header?: { frame_id?: string; stamp?: unknown };
  width: number;
  height: number;
  point_step: number;
  row_step: number;
  is_bigendian?: boolean;
  fields: { name: string; offset: number; datatype: number; count: number }[];
  data: unknown;
}

/** Decode into the renderer's reusable XYZ buffer. Validate the complete layout before writing. */
export function decodePointCloud(message: PointCloudMessage, output: Float32Array): number {
  const { width, height, point_step: pointStep, row_step: rowStep } = message;
  if (!Array.isArray(message.fields)) throw new Error('PointCloud2 fields are missing.');
  if (
    ![width, height, pointStep, rowStep].every(v => Number.isSafeInteger(v) && v >= 0) ||
    pointStep === 0 ||
    rowStep < width * pointStep ||
    !Number.isSafeInteger(rowStep * height)
  )
    throw new Error('Invalid PointCloud2 dimensions or row/point stride.');
  const coordinates = ['x', 'y', 'z'].map(name => {
    const field = message.fields?.find(field => field.name === name);
    const decoder = field && fields[field.datatype];
    if (
      !field ||
      !decoder ||
      field.count !== 1 ||
      !Number.isSafeInteger(field.offset) ||
      field.offset < 0 ||
      field.offset + decoder.size > pointStep
    )
      throw new Error(`Unsupported PointCloud2 ${name} field layout.`);
    return { ...decoder, offset: field.offset };
  });
  let bytes: Uint8Array;
  const data = message.data;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (Array.isArray(data) && data.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
    bytes = Uint8Array.from(data);
  else if (typeof data === 'string') bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  else throw new Error('Unsupported PointCloud2 byte payload.');
  if (bytes.byteLength < rowStep * height) throw new Error('Truncated PointCloud2 data.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = !message.is_bigendian;
  const capacity = Math.floor(output.length / 3);
  // Bound CPU work as well as output memory, even when every point is invalid.
  const count = Math.min(width * height, capacity);
  let written = 0;
  for (let i = 0; i < count; i++) {
    const base = Math.floor(i / width) * rowStep + (i % width) * pointStep;
    const x = coordinates[0].read(view, base + coordinates[0].offset, little);
    const y = coordinates[1].read(view, base + coordinates[1].offset, little);
    const z = coordinates[2].read(view, base + coordinates[2].offset, little);
    if (![x, y, z].every(v => Number.isFinite(v) && Math.abs(v) <= 3.402823466e38)) continue;
    output[written++] = x;
    output[written++] = y;
    output[written++] = z;
  }
  return written / 3;
}
