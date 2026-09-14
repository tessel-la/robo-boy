import { beforeEach, describe, expect, it, vi } from 'vitest';

const discoverAllROSResourcesMock = vi.hoisted(() => vi.fn());
vi.mock('../../behaviorTree/services/rosDiscovery', () => ({
  discoverAllROSResources: discoverAllROSResourcesMock,
}));

import { createRosGraphCache } from './rosGraphCache';

const emptyResult = { actions: [], services: [], topics: [] };

describe('createRosGraphCache', () => {
  beforeEach(() => {
    discoverAllROSResourcesMock.mockReset();
  });

  it('returns a fresh result on first call and caches it for the same ros+generation', async () => {
    discoverAllROSResourcesMock.mockResolvedValue(emptyResult);
    const cache = createRosGraphCache(30_000);
    const ros = {} as any;

    const first = await cache.get(ros, 1);
    const second = await cache.get(ros, 1);

    expect(first?.result).toBe(emptyResult);
    expect(second?.result).toBe(emptyResult);
    expect(discoverAllROSResourcesMock).toHaveBeenCalledOnce();
  });

  it('de-dupes concurrent callers into a single in-flight discovery call', async () => {
    let resolveDiscovery: (value: typeof emptyResult) => void = () => undefined;
    discoverAllROSResourcesMock.mockReturnValue(
      new Promise(resolve => {
        resolveDiscovery = resolve;
      })
    );
    const cache = createRosGraphCache();
    const ros = {} as any;

    const first = cache.get(ros, 1);
    const second = cache.get(ros, 1);
    resolveDiscovery(emptyResult);

    const [firstEntry, secondEntry] = await Promise.all([first, second]);
    expect(discoverAllROSResourcesMock).toHaveBeenCalledOnce();
    expect(firstEntry?.result).toBe(emptyResult);
    expect(secondEntry?.result).toBe(emptyResult);
  });

  it('re-fetches for a new connection generation instead of returning the stale cache entry', async () => {
    discoverAllROSResourcesMock.mockResolvedValue(emptyResult);
    const cache = createRosGraphCache(30_000);
    const ros = {} as any;

    await cache.get(ros, 1);
    await cache.get(ros, 2);

    expect(discoverAllROSResourcesMock).toHaveBeenCalledTimes(2);
  });

  it('discards (returns null) a result that resolves after the generation has already moved on', async () => {
    let resolveFirst: (value: typeof emptyResult) => void = () => undefined;
    discoverAllROSResourcesMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    discoverAllROSResourcesMock.mockImplementationOnce(async () => emptyResult);

    const cache = createRosGraphCache();
    const ros = {} as any;

    const staleCall = cache.get(ros, 1); // reconnect happens before this resolves
    const freshCall = cache.get(ros, 2); // new generation starts its own fetch

    await freshCall;
    resolveFirst(emptyResult);
    const staleResult = await staleCall;

    expect(staleResult).toBeNull();
  });

  it('respects the TTL, re-fetching after it expires', async () => {
    discoverAllROSResourcesMock.mockResolvedValue(emptyResult);
    const cache = createRosGraphCache(1);
    const ros = {} as any;

    await cache.get(ros, 1);
    await new Promise(resolve => setTimeout(resolve, 5));
    await cache.get(ros, 1);

    expect(discoverAllROSResourcesMock).toHaveBeenCalledTimes(2);
  });
});
