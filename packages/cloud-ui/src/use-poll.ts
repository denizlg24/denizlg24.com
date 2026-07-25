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

  const reload = useCallback(async () => {
    const started = generation.current;
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
      if (started === generation.current) setLoading(false);
    }
  }, [fn]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const timer =
      intervalMs === null ? null : setInterval(() => void reload(), intervalMs);
    return () => {
      generation.current += 1;
      if (timer !== null) clearInterval(timer);
    };
  }, [reload, intervalMs]);

  return { data, error, unreachable, loading, reload };
}
