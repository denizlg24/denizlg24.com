"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * View settings that should survive a reload. Reads happen after mount so the
 * server and first client render agree.
 */
export function usePreference<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    const stored = window.localStorage.getItem(`storage:${key}`);
    if (stored && (allowed as readonly string[]).includes(stored)) {
      setValue(stored as T);
    }
    // `allowed` is a literal tuple at every call site; re-running on identity
    // changes would reset the preference on every render.
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      window.localStorage.setItem(`storage:${key}`, next);
    },
    [key],
  );

  return [value, update];
}
