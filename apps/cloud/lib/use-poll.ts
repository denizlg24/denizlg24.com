"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export function usePoll<T>(fn: () => Promise<T>, intervalMs: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    } catch (err) {
      if (started !== generation.current) return;
      setError(errorMessage(err));
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

  return { data, error, loading, reload };
}
