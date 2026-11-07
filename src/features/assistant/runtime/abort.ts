/** AbortSignal.any/timeout are not available in older supported mobile WebViews. Keep
 * composition explicit and release listeners/timers when a bounded operation settles. */
export function timedSignal(signal: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Operation timed out.', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    },
  };
}
