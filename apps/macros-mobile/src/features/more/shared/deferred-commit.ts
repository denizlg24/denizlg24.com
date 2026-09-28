import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const UNDO_WINDOW_MS = 4_800;

/**
 * Holds a destructive write back for a few seconds so it can be undone in
 * place. Leaving the screen or the app commits whatever is still pending, so a
 * delete is never silently dropped.
 */
export function useDeferredCommit(commit: (id: string) => void) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  const forget = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setPending((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const fire = useCallback(
    (id: string) => {
      forget(id);
      commitRef.current(id);
    },
    [forget],
  );

  const schedule = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      setPending((current) => new Set(current).add(id));
      timers.current.set(
        id,
        setTimeout(() => fire(id), UNDO_WINDOW_MS),
      );
    },
    [fire],
  );

  const flush = useCallback(() => {
    for (const id of [...timers.current.keys()]) fire(id);
  }, [fire]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") flushRef.current();
    });
    return () => {
      subscription.remove();
      flushRef.current();
    };
  }, []);

  return { pending, schedule, undo: forget, flush };
}
