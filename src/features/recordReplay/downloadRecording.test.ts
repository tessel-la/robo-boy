import { afterEach, describe, expect, it, vi } from 'vitest';
import { rangeServer, type Failure } from '../../test/rangeServer';
import { canSaveToDisk, chooseSaveTarget, RecordingDownload, type DownloadSnapshot } from './downloadRecording';

const DATA = Uint8Array.from({ length: 50_000 }, (_, index) => index % 253);
const BAG = { url: 'http://robot.local:9091/files/run_0.mcap', name: 'run_0.mcap', size: DATA.length };

/** A save target recording what was written, as FileSystemWritableFileStream would. */
function saveTarget() {
  const chunks: Uint8Array[] = [];
  const target = { closed: false, aborted: false, written: () => new Uint8Array(chunks.flatMap(chunk => [...chunk])) };
  const handle = {
    createWritable: async () => ({
      write: async (chunk: Uint8Array) => { chunks.push(chunk.slice()); },
      close: async () => { target.closed = true; },
      abort: async () => { target.aborted = true; },
    }),
    getFile: async () => new File([target.written()], BAG.name),
  } as unknown as FileSystemFileHandle;
  return { handle, target };
}

/** A body that sends part of the file, then drops the connection. */
function droppingServer(dropAfter: number, options: Parameters<typeof rangeServer>[1] = {}) {
  const server = rangeServer(DATA, options);
  let dropped = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await server.fetch(input, init);
    if (dropped) return response;
    dropped = true;
    const reader = response.body!.getReader();
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value } = await reader.read();
        if (sent >= dropAfter || !value) { controller.error(new TypeError('network error')); return; }
        const part = value.slice(0, dropAfter - sent);
        sent += part.length;
        controller.enqueue(part);
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests: server.requests };
}

const run = async (fetcher: typeof fetch, retryDelays = [1, 1]) => {
  const { handle, target } = saveTarget();
  const updates: DownloadSnapshot[] = [];
  const download = new RecordingDownload(BAG, handle, snapshot => updates.push(snapshot), { fetch: fetcher, retryDelays, idleTimeout: 50 });
  await download.run();
  return { download, target, updates };
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('RecordingDownload', () => {
  it('streams the recording to the chosen file and hands it to Replay', async () => {
    const { download, target, updates } = await run(rangeServer(DATA).fetch);
    expect(download.snapshot).toMatchObject({ phase: 'done', loaded: DATA.length, total: DATA.length });
    expect(target.written()).toEqual(DATA);
    expect(target.closed).toBe(true);
    expect(updates[updates.length - 1]?.phase).toBe('done');
    const file = await download.file();
    expect(file.name).toBe('run_0.mcap');
  });

  it('resumes from the last byte written when the connection drops', async () => {
    const server = droppingServer(12_345);
    const { download, target } = await run(server.fetch);
    expect(download.snapshot.phase).toBe('done');
    expect(server.requests.map(request => request.range)).toEqual([undefined, 'bytes=12345-']);
    expect(target.written()).toEqual(DATA);
  });

  it('stops after repeated failures, keeping what it has, and continues when asked', async () => {
    const failures: Failure[] = ['network', 'network', 'network'];
    const { download, target } = await run(rangeServer(DATA, { failures }).fetch);
    expect(download.snapshot).toMatchObject({ phase: 'error', loaded: 0 });
    expect(download.snapshot.error).toContain('The download stopped at 0%');
    expect(download.canResume).toBe(true);
    expect(target.aborted).toBe(false);
    (download as unknown as { options: { fetch: typeof fetch } }).options.fetch = rangeServer(DATA).fetch;
    await download.run();
    expect(download.snapshot.phase).toBe('done');
    expect(target.written()).toEqual(DATA);
  });

  it('throws the partial file away when the recording changed or is gone', async () => {
    let version = 1;
    const { download, target } = await run(droppingServer(1000, { etag: () => `"v${version++}"` }).fetch);
    expect(download.snapshot).toMatchObject({ phase: 'error', error: expect.stringContaining('changed on the ROS host') });
    expect(target.aborted).toBe(true);
    expect(download.canResume).toBe(false);

    const gone = await run(rangeServer(DATA, { failures: [404] }).fetch);
    expect(gone.download.snapshot.error).toBe('The recording is no longer on the ROS host.');
    expect(gone.target.aborted).toBe(true);
  });

  it('cancels, deleting the partial file', async () => {
    const { handle, target } = saveTarget();
    const download = new RecordingDownload(BAG, handle, () => undefined, { fetch: rangeServer(DATA, { failures: ['stall'] }).fetch, idleTimeout: 10_000 });
    const running = download.run();
    await vi.waitFor(() => expect((download as unknown as { writable?: unknown }).writable).toBeDefined());
    await download.cancel();
    await running;
    expect(target.aborted).toBe(true);
    expect(download.snapshot.phase).toBe('downloading');
  });
});

describe('save target', () => {
  it('uses the file picker where the browser has one, and treats closing it as no choice', async () => {
    expect(canSaveToDisk()).toBe(false);
    const picker = vi.fn().mockResolvedValueOnce('handle').mockRejectedValueOnce(new DOMException('closed', 'AbortError'));
    vi.stubGlobal('showSaveFilePicker', picker);
    expect(canSaveToDisk()).toBe(true);
    await expect(chooseSaveTarget('run_0.mcap')).resolves.toBe('handle');
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'run_0.mcap' }));
    await expect(chooseSaveTarget('run_0.mcap')).resolves.toBeNull();
  });
});
