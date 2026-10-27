/** Missing/zero stamps use ROS's latest-transform convention. Malformed stamps never do. */
export function rosStamp(stamp: unknown): bigint | null {
  if (stamp === undefined) return 0n;
  if (!stamp || typeof stamp !== 'object') return null;
  const value = stamp as Record<string, unknown>;
  const sec = value.sec ?? value.secs;
  const nsec = value.nanosec ?? value.nsecs;
  if (
    !Number.isSafeInteger(sec) ||
    !Number.isSafeInteger(nsec) ||
    (sec as number) < 0 ||
    (nsec as number) < 0 ||
    (nsec as number) >= 1e9
  )
    return null;
  return BigInt(sec as number) * 1_000_000_000n + BigInt(nsec as number);
}
