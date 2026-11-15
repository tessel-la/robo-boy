import { useCallback, useEffect, useRef } from 'react';
/** A later file, unmount, connection change, or editing lock invalidates pending reads/reviews. */
export function useImportSession(owner: unknown, enabled = true) {
  const current = useRef<AbortController>();
  useEffect(() => {
    if (!enabled) current.current?.abort();
    return () => current.current?.abort();
  }, [owner, enabled]);
  return useCallback(() => {
    current.current?.abort();
    current.current = new AbortController();
    if (!enabled) current.current.abort();
    return current.current.signal;
  }, [enabled]);
}
