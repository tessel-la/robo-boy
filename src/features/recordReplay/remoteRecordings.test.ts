import { describe, expect, it, vi } from 'vitest';
import { fetchListing, parseListing, recordingFileUrl, remoteBag } from './remoteRecordings';

const json = (value: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(value), { status })) as unknown as typeof fetch;

describe('remote recordings', () => {
  it('builds file URLs that survive unusual names, and resolves them for the worker', () => {
    expect(recordingFileUrl('http://robot.local:9091', 'field day/run #1/run_0.mcap')).toBe('http://robot.local:9091/files/field%20day/run%20%231/run_0.mcap');
    expect(recordingFileUrl('/recordings/', 'a.mcap')).toBe(`${location.origin}/recordings/files/a.mcap`);
    expect(remoteBag('/recordings', { name: 'a.mcap', path: 'x/a.mcap', size: 12, modified: 0 })).toEqual({ url: `${location.origin}/recordings/files/x/a.mcap`, name: 'a.mcap', size: 12 });
  });

  it('keeps only well-formed entries from a listing', () => {
    expect(parseListing({
      version: 1, directory: '.', folders: ['day1', 3, ''],
      files: [{ name: 'a.mcap', path: 'a.mcap', size: 5 }, { name: 'bad.mcap', path: 'bad.mcap', size: -1 }],
      recordings: [
        { name: 'run', path: 'run', active: false, duration: 12.5, messages: 340, files: [{ name: 'run_0.mcap', path: 'run/run_0.mcap', size: 9, modified: 7 }] },
        { name: 'live', path: 'live', active: true, files: [] },
        { path: 'nameless' },
      ],
    })).toEqual({
      directory: '', folders: ['day1'], files: [{ name: 'a.mcap', path: 'a.mcap', size: 5, modified: 0 }],
      recordings: [
        { name: 'run', path: 'run', active: false, duration: 12.5, messages: 340, files: [{ name: 'run_0.mcap', path: 'run/run_0.mcap', size: 9, modified: 7 }] },
        { name: 'live', path: 'live', active: true, files: [], duration: undefined, messages: undefined },
      ],
    });
    expect(() => parseListing({ version: 2 })).toThrow('unknown recordings format');
  });

  it('asks for one folder of the recording root', async () => {
    const fetcher = json({ version: 1, directory: 'field day', folders: [], files: [], recordings: [] });
    await expect(fetchListing('/recordings', 'field day', undefined, fetcher)).resolves.toMatchObject({ directory: 'field day' });
    expect(fetcher).toHaveBeenCalledWith('/recordings/list?path=field%20day', expect.objectContaining({ cache: 'no-store' }));
  });

  it('explains why recordings cannot be listed', async () => {
    const unreachable = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchListing('/recordings', '', undefined, unreachable)).rejects.toThrow('set ROBOBOY_RECORDINGS_PORT there');
    await expect(fetchListing('/recordings', '', undefined, json({}, 502))).rejects.toThrow('The recorder on the ROS host did not answer');
    await expect(fetchListing('/recordings', '', undefined, json({}, 500))).rejects.toThrow('does not serve its recordings');
    await expect(fetchListing('/recordings', '', undefined, json({}, 404))).rejects.toThrow('does not serve its recordings');
    await expect(fetchListing('/recordings', '..', undefined, json({ error: 'Choose a path inside the recording root' }, 400))).rejects.toThrow('Choose a path inside the recording root');
    const html = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchListing('/recordings', '', undefined, html)).rejects.toThrow('something other than a recordings list');
  });
});
