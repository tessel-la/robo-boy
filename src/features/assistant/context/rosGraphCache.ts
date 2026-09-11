import type { Ros } from 'roslib';
import { discoverAllROSResources } from '../../behaviorTree/services/rosDiscovery';
import type { ROSDiscoveryResult } from '../../behaviorTree/types';

const DEFAULT_TTL_MS = 30_000;

export interface RosGraphCacheEntry {
  result: ROSDiscoveryResult;
  fetchedAt: number;
  generation: number;
}

interface InFlightRequest {
  ros: Ros;
  generation: number;
  promise: Promise<ROSDiscoveryResult>;
}

export interface RosGraphCache {
  /**
   * Returns the cached discovery result when it is fresh for this exact `(ros, generation)` pair,
   * de-dupes concurrent callers into a single in-flight `discoverAllROSResources` call, and
   * discards (returns null) a result that resolves after the connection has already moved on to a
   * new generation — closing the reconnect-invalidation gap documented in the plan for this one
   * new caller, without touching `discoverAllROSResources` or any of its other existing callers.
   */
  get(ros: Ros, generation: number, options?: { forceRefresh?: boolean }): Promise<RosGraphCacheEntry | null>;
  clear(): void;
}

export const createRosGraphCache = (ttlMs: number = DEFAULT_TTL_MS): RosGraphCache => {
  let entry: (RosGraphCacheEntry & { ros: Ros }) | null = null;
  let inFlight: InFlightRequest | null = null;

  const get: RosGraphCache['get'] = async (ros, generation, options) => {
    const now = Date.now();
    if (
      !options?.forceRefresh &&
      entry &&
      entry.ros === ros &&
      entry.generation === generation &&
      now - entry.fetchedAt < ttlMs
    ) {
      return { result: entry.result, fetchedAt: entry.fetchedAt, generation: entry.generation };
    }

    if (inFlight && inFlight.ros === ros && inFlight.generation === generation) {
      // Piggyback on the in-flight request rather than starting a second one. Read the outcome
      // back from `entry` afterward (not from the shared, mutable `inFlight` variable) — by the
      // time our `await` resumes, the original caller's own continuation may already have run
      // and cleared/replaced `inFlight`, so re-reading it here would race.
      await inFlight.promise.catch(() => undefined);
      if (entry && entry.ros === ros && entry.generation === generation) {
        return { result: entry.result, fetchedAt: entry.fetchedAt, generation };
      }
      return null;
    }

    const promise = discoverAllROSResources(ros);
    const thisRequest: InFlightRequest = { ros, generation, promise };
    inFlight = thisRequest;
    try {
      const result = await promise;
      // Identity comparison, not a field comparison: a newer request (any generation) may have
      // already become the current `inFlight` while this one was in progress. Only the request
      // that is still the current one gets to populate the cache.
      if (inFlight !== thisRequest) return null;
      const fetchedAt = Date.now();
      entry = { ros, generation, fetchedAt, result };
      return { result, fetchedAt, generation };
    } finally {
      if (inFlight === thisRequest) inFlight = null;
    }
  };

  const clear = () => {
    entry = null;
    inFlight = null;
  };

  return { get, clear };
};
