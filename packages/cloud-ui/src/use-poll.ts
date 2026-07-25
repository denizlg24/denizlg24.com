"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isUnreachable } from "./api-error";

export interface PollState<T> {
  data: T | null;
  error: string | null;
  /** The Pi answered nothing at all — render the degraded state, not an error. */
  unreachable: boolean;
  loading: boolean;
  reload: () => Promise<void>;
}

export function usePoll<T>(
  fn: () => Promise<T>,
  intervalMs: number | null,
): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [loading, setLoading] = useState(true);
  // Bumped whenever `fn` changes or the hook unmounts, so a request started
  // against an older `fn` can never write its result over a newer one.
  const generation = useRef(0);

  // `trackPending` is false for interval ticks: a background poll refreshing
  // in place must not flip `loading` and flash every consumer's skeleton or
  // spinner. Explicit calls (first load, retry button) do track it, so a retry
  // can disable its trigger instead of allowing overlapping requests.
  const run = useCallback(
    async (trackPending: boolean) => {
      const started = generation.current;
      if (trackPending) setLoading(true);
      try {
        const next = await fn();
        if (started !== generation.current) return;
        setData(next);
        setError(null);
        setUnreachable(false);
      } catch (err) {
        if (started !== generation.current) return;
        setError(errorMessage(err));
        setUnreachable(isUnreachable(err));
      } finally {
        if (trackPending && started === generation.current) setLoading(false);
      }
    },
    [fn],
  );

  const reload = useCallback(() => run(true), [run]);

  useEffect(() => {
    void run(true);
    const timer =
      intervalMs === null
        ? null
        : setInterval(() => void run(false), intervalMs);
    return () => {
      generation.current += 1;
      if (timer !== null) clearInterval(timer);
    };
  }, [run, intervalMs]);

  return { data, error, unreachable, loading, reload };
}
