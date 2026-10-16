import { useCallback, useRef } from "react";

const REPEAT_WINDOW_MS = 600;

/**
 * Drops a repeat press that lands before the first one's result is visible:
 * a double tap on Save or Log would otherwise send the write twice, each
 * with its own idempotency key. Presses further apart than the window pass.
 */
export function useSinglePress<Args extends unknown[]>(
  handler: ((...args: Args) => void) | null | undefined,
): (...args: Args) => void {
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const latest = useRef(handler);
  latest.current = handler;
  return useCallback((...args: Args) => {
    const now = Date.now();
    if (now - lastAt.current < REPEAT_WINDOW_MS) return;
    lastAt.current = now;
    latest.current?.(...args);
  }, []);
}
