import { MAX_IMAGE_BYTES } from './imageFrames';

const MAX_HEADERS = 8192;
const crlf = new Uint8Array([13, 10, 13, 10]);
function indexOf(bytes: Uint8Array, needle: Uint8Array, from = 0) {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
/** Linear, bounded multipart reader; payloads are allocated once, independently of network chunk size. */
export class MjpegParser {
  private headers = new Uint8Array(0);
  private payload?: Uint8Array;
  private written = 0;
  private readonly boundary: Uint8Array;
  private started = false;
  constructor(
    contentType: string,
    private onFrame: (bytes: Uint8Array) => void
  ) {
    const match = /^multipart\/x-mixed-replace\s*;[\s\S]*?boundary\s*=\s*(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(
      contentType
    );
    const value = match?.[1] ?? match?.[2];
    if (!value || value.length > 200 || /[^\x21-\x7e]/.test(value))
      throw new Error('Camera stream has no valid multipart boundary.');
    this.boundary = new TextEncoder().encode(`--${value}`);
  }
  push(chunk: Uint8Array) {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.payload) {
        const amount = Math.min(chunk.length - offset, this.payload.length - this.written);
        this.payload.set(chunk.subarray(offset, offset + amount), this.written);
        this.written += amount;
        offset += amount;
        if (this.written === this.payload.length) {
          const complete = this.payload;
          this.payload = undefined;
          this.written = 0;
          this.onFrame(complete);
        }
        continue;
      }
      // Headers remain small. A slice may include the first payload bytes; feed those
      // through push after parsing, with recursion bounded to this 8 KiB header window.
      const amount = Math.min(chunk.length - offset, MAX_HEADERS - this.headers.length);
      if (!amount) throw new Error('Camera multipart headers exceed their limit.');
      const joined = new Uint8Array(this.headers.length + amount);
      joined.set(this.headers);
      joined.set(chunk.subarray(offset, offset + amount), this.headers.length);
      this.headers = joined;
      offset += amount;
      const boundary = indexOf(this.headers, this.boundary);
      if (boundary < 0) continue;
      if (this.started && boundary > 2) throw new Error('Unexpected data between camera frames.');
      const start = boundary + this.boundary.length;
      const end = indexOf(this.headers, crlf, start);
      if (end < 0) continue;
      const text = new TextDecoder().decode(this.headers.subarray(start, end));
      const lengths = [...text.matchAll(/(?:^|\r\n)content-length\s*:\s*([^\r\n]+)/gi)];
      if (lengths.length !== 1 || !/^\d+$/.test(lengths[0][1].trim()))
        throw new Error('Camera frame has no valid Content-Length.');
      const length = Number(lengths[0][1]);
      if (!Number.isSafeInteger(length) || length < 4 || length > MAX_IMAGE_BYTES)
        throw new Error('Camera frame exceeds its byte limit.');
      if (!/(?:^|\r\n)content-type\s*:\s*image\/jpeg\s*(?:\r\n|$)/i.test(text))
        throw new Error('Camera multipart frame is not JPEG.');
      const remaining = this.headers.subarray(end + 4);
      this.headers = new Uint8Array(0);
      this.payload = new Uint8Array(length);
      this.started = true;
      if (remaining.length) this.push(remaining);
    }
  }
}
