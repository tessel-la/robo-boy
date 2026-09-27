import { describe, expect, it } from 'vitest';
import { rangeServer, type Failure } from '../../test/rangeServer';
import { HttpReadable } from './httpReadable';

const URL = 'http://robot.local:9091/files/field/run_0.mcap';
const DATA = Uint8Array.from({ length: 10_000 }, (_, index) => index % 251);
const fast = { retryDelays: [1, 1, 1], idleTimeout: 50 };
const readable = (server: ReturnType<typeof rangeServer>, options = {}) =>
  new HttpReadable(URL, DATA.length, { fetch: server.fetch, ...fast, ...options });
const failing = (...failures: Failure[]) => rangeServer(DATA, { failures });

describe('HttpReadable', () => {
  it('reads any byte range of the remote file, across block boundaries', async () => {
    const file = readable(rangeServer(DATA), { readAhead: 0 });
    expect(await file.size()).toBe(10_000n);
    expect(await file.read(990n, 25n)).toEqual(DATA.slice(990, 1015));
    expect(await file.read(9990n, 10n)).toEqual(DATA.slice(9990));
    expect(await file.read(5n, 0n)).toEqual(new Uint8Array());
    await expect(file.read(9995n, 10n)).rejects.toThrow('past the end');
  });

  it('fetches exactly what is read while reads jump around, as they do when a bag is opened', async () => {
    const server = rangeServer(DATA);
    const file = readable(server, { readAhead: 4000 });
    await file.read(0n, 8n);
    await file.read(9972n, 28n);
    await file.read(9000n, 900n);
    expect(server.requests.map(request => request.range)).toEqual(['bytes=0-7', 'bytes=9972-9999', 'bytes=9000-9899']);
  });

  it('reads ahead once reads run in file order, as playback does, and serves them from memory', async () => {
    const server = rangeServer(DATA);
    const file = readable(server, { readAhead: 4000 });
    expect(await file.read(0n, 100n)).toEqual(DATA.slice(0, 100));
    expect(await file.read(120n, 180n)).toEqual(DATA.slice(120, 300));
    expect(server.requests.map(request => request.range)).toEqual(['bytes=0-99', 'bytes=120-299', 'bytes=300-4299']);
    expect(await file.read(300n, 500n)).toEqual(DATA.slice(300, 800));
    expect(await file.read(3000n, 500n)).toEqual(DATA.slice(3000, 3500));
    // Less than half a read-ahead was left, so the next stretch went out; nothing else did.
    expect(server.requests.map(request => request.range)).toEqual(['bytes=0-99', 'bytes=120-299', 'bytes=300-4299', 'bytes=4300-8299']);
    // A read across two fetched stretches is put together from both.
    expect(await file.read(4200n, 300n)).toEqual(DATA.slice(4200, 4500));
    expect(server.requests).toHaveLength(4);
  });

  it('fetches only the part of a read the cache does not hold', async () => {
    const server = rangeServer(DATA);
    const file = readable(server, { readAhead: 0 });
    await file.read(0n, 1000n);
    expect(await file.read(500n, 1000n)).toEqual(DATA.slice(500, 1500));
    expect(server.requests.map(request => request.range)).toEqual(['bytes=0-999', 'bytes=1000-1499']);
  });

  it('keeps a bounded cache, fetching evicted bytes again', async () => {
    const server = rangeServer(DATA);
    const file = readable(server, { readAhead: 0, cacheBytes: 250 });
    await file.read(0n, 100n);
    await file.read(1000n, 100n);
    await file.read(2000n, 100n);
    await file.read(0n, 100n);
    expect(server.requests).toHaveLength(4);
    await file.read(2000n, 50n);
    expect(server.requests).toHaveLength(4);
  });

  it('rides out a dropped connection, a server error, a truncated body and a stalled one', async () => {
    const server = failing('network', 503, 'short', 'stall');
    const file = readable(server, { readAhead: 0, retryDelays: [1, 1, 1, 1] });
    expect(await file.read(100n, 50n)).toEqual(DATA.slice(100, 150));
    expect(server.requests).toHaveLength(5);
  });

  it('reports a lost connection once retries run out, and tries again on the next read', async () => {
    const server = failing('network', 'network', 'network', 'network');
    const file = readable(server, { readAhead: 0 });
    await expect(file.read(0n, 10n)).rejects.toThrow('Lost the connection to the ROS host while reading the recording (Failed to fetch)');
    expect(await file.read(0n, 10n)).toEqual(DATA.slice(0, 10));
  });

  it('does not retry what retrying cannot fix', async () => {
    for (const [server, message] of [
      [failing(404), 'no longer on the ROS host'],
      [failing(409), 'still being written'],
      [rangeServer(DATA, { ranges: false }), 'cannot be replayed in place'],
      [rangeServer(DATA, { size: 20_000 }), 'changed on the ROS host'],
    ] as const) {
      await expect(readable(server, { readAhead: 0 }).read(0n, 10n)).rejects.toThrow(message);
      expect(server.requests).toHaveLength(1);
    }
  });

  it('notices when the file is replaced between reads', async () => {
    let version = 1;
    const file = readable(rangeServer(DATA, { etag: () => `"v${version}"` }), { readAhead: 0 });
    await file.read(0n, 10n);
    version = 2;
    await expect(file.read(5000n, 10n)).rejects.toThrow('changed on the ROS host');
  });
});
