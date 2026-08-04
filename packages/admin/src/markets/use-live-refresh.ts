"use client";

import { useEffect, useRef } from "react";

export interface LiveRefreshOptions {
  intervalMs: number;
  /** Set false to hold a surface still while it has nothing worth re-asking. */
  enabled?: boolean;
}

/**
 * Runs `refresh` on an interval while the tab is actually being looked at, and
 * once immediately whenever it is looked at again.
 *
 * Both halves matter. A background tab that keeps polling spends provider
 * budget rendering pixels nobody can see, and a tab coming back from the
 * background is precisely when what is on screen is furthest out of date —
 * leaving a market page open all morning and finding it frozen at the opening
 * print is the failure this exists to prevent.
 *
 * The callback is read through a ref, so a caller may pass a fresh closure on
 * every render without tearing the timer down and restarting the interval.
 */
export function useLiveRefresh(
  refresh: () => void,
  options: LiveRefreshOptions,
): void {
  const { intervalMs, enabled = true } = options;
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;
    // The mount is not a refresh: whoever mounted this already loaded once.
    let mounted = false;

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const sync = () => {
      if (document.hidden) {
        stop();
        return;
      }
      if (mounted) latest.current();
      mounted = true;
      if (!timer) timer = setInterval(() => latest.current(), intervalMs);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [enabled, intervalMs]);
}
