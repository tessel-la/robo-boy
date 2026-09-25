/**
 * LZ4 frame decompression (https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md) in plain
 * TypeScript. MCAP chunks are small and self-contained, and a wasm build would need a bundler
 * plugin plus a CSP exception on every platform, so this stays dependency-free.
 */
export function decompressLz4Frame(input: Uint8Array, size: number): Uint8Array {
  const output = new Uint8Array(size);
  let at = 0;
  let written = 0;
  const u32 = () => {
    const value = (input[at] | (input[at + 1] << 8) | (input[at + 2] << 16) | (input[at + 3] << 24)) >>> 0;
    at += 4;
    return value;
  };
  while (at < input.length) {
    const magic = u32();
    if ((magic & 0xfffffff0) === 0x184d2a50) { at += u32(); continue; } // Skippable frame.
    if (magic !== 0x184d2204) throw new Error('This LZ4 chunk is not an LZ4 frame.');
    const flags = input[at];
    if (flags >> 6 !== 1) throw new Error('Unsupported LZ4 frame version.');
    at += 2 + (flags & 0x08 ? 8 : 0) + (flags & 0x01 ? 4 : 0) + 1; // FLG, BD, size, dictionary, header checksum.
    const blockChecksum = Boolean(flags & 0x10);
    for (;;) {
      const header = u32();
      if (header === 0) break;
      const length = header & 0x7fffffff;
      const end = at + length;
      if (end > input.length) throw new Error('Truncated LZ4 block.');
      if (header & 0x80000000) {
        if (written + length > size) throw new Error('LZ4 data is larger than the chunk says.');
        output.set(input.subarray(at, end), written);
        written += length;
      } else {
        written = decompressBlock(input, at, end, output, written);
      }
      at = end + (blockChecksum ? 4 : 0);
    }
    if (flags & 0x04) at += 4; // Content checksum.
  }
  if (written !== size) throw new Error('LZ4 data is smaller than the chunk says.');
  return output;
}

function decompressBlock(input: Uint8Array, at: number, end: number, output: Uint8Array, written: number): number {
  const extend = (length: number) => {
    if (length !== 15) return length;
    let byte: number;
    do { byte = input[at++]; length += byte; } while (byte === 255 && at < end);
    return length;
  };
  while (at < end) {
    const token = input[at++];
    const literals = extend(token >> 4);
    if (at + literals > end || written + literals > output.length) throw new Error('Corrupt LZ4 block.');
    output.set(input.subarray(at, at + literals), written);
    at += literals;
    written += literals;
    if (at >= end) break; // The last sequence has literals only.
    const offset = input[at] | (input[at + 1] << 8);
    at += 2;
    const matchLength = extend(token & 15) + 4;
    let from = written - offset;
    if (offset === 0 || from < 0 || written + matchLength > output.length) throw new Error('Corrupt LZ4 block.');
    // Matches may overlap what they write, so copy forward byte by byte when they do.
    if (offset >= matchLength) { output.copyWithin(written, from, from + matchLength); written += matchLength; }
    else for (let index = 0; index < matchLength; index++) output[written++] = output[from++];
  }
  return written;
}
